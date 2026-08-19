import { db } from "./db.js";
import {
  getCustomerById,
  getCustomerByPhone,
  getCustomerTransactions,
  type IikoCustomer,
} from "../iikoClient.js";
import { rebuildWeek } from "./aggregate.js";
import { mergeGuestIdentity } from "./identity.js";
import { addWeeks, currentWeekStart, weekStart } from "./weeks.js";

/**
 * Бэкфилл исторических данных БЕЗ вебхука: по списку телефонов гостей
 * (разовый экспорт из iikoWeb) тянем из iiko транзакции за год —
 * закрытые чеки (CloseOrder) → orders_daily + guests, затем пересчёт недель.
 *
 * Идемпотентно: чеки дедупятся по id транзакции iiko (processed_orders).
 */

const upsertDaily = db.prepare(`
  INSERT INTO orders_daily (date, guestIikoId, ordersCount, ordersSum)
  VALUES (@date, @guestIikoId, 1, @sum)
  ON CONFLICT(date, guestIikoId) DO UPDATE SET
    ordersCount = ordersCount + 1,
    ordersSum   = ordersSum + @sum
`);
const upsertGuest = db.prepare(`
  INSERT INTO guests (iikoId, phone, name, surname, firstSeen, lastSeen)
  VALUES (@iikoId, @phone, @name, @surname, @ts, @ts)
  ON CONFLICT(iikoId) DO UPDATE SET
    phone   = COALESCE(excluded.phone, guests.phone),
    name    = COALESCE(excluded.name, guests.name),
    surname = COALESCE(excluded.surname, guests.surname)
`);
const markProcessed = db.prepare(
  "INSERT OR IGNORE INTO processed_orders (orderId, whenSeen) VALUES (?, ?)",
);

export interface BackfillResult {
  phone: string;
  status: "ok" | "not_found" | "error";
  guestId?: string;
  checksImported?: number;
  error?: string;
}

/** Импорт CloseOrder-транзакций гостя за `days` дней (чеки → orders_daily). */
async function importTxns(guestId: string, days: number): Promise<number> {
  const txns = await getCustomerTransactions(guestId, days);
  let imported = 0;
  const tx = db.transaction(() => {
    for (const t of txns) {
      if (t.typeName !== "CloseOrder") continue;
      // Дедуп по id транзакции iiko (префикс, чтобы не пересечься с orderId вебхуков).
      const info = markProcessed.run("iiko-tx-" + t.id, new Date().toISOString());
      if (info.changes === 0) continue;
      const date = (t.whenCreated ?? "").slice(0, 10);
      if (!date) continue;
      upsertDaily.run({ date, guestIikoId: guestId, sum: t.orderSum ?? t.sum ?? 0 });
      imported++;
    }
  });
  tx();
  return imported;
}

/** Сохранить категорию лояльности гостя из iiko (напр. «VIP Cashback 15%»). */
const setCategory = db.prepare(
  "UPDATE guests SET category = ? WHERE iikoId = ?",
);
/** Сохранить номер карты гостя — ключ сопоставления с OLAP-отчётом. */
const setCard = db.prepare("UPDATE guests SET cardTrack = ? WHERE iikoId = ?");

/** Профиль гостя → доп. поля (категория, карта) в guests. */
function saveGuestMeta(c: IikoCustomer): void {
  if (c.category) setCategory.run(c.category, c.id);
  const track = c.cards?.[0]?.track || c.cards?.[0]?.number;
  if (track) setCard.run(track, c.id);
}

/** Импорт истории уже найденного гостя (профиль + чеки → orders_daily). */
async function backfillCustomer(
  c: IikoCustomer,
  days: number,
): Promise<number> {
  upsertGuest.run({
    iikoId: c.id,
    phone: c.phone,
    name: c.name,
    surname: c.surname,
    ts: new Date().toISOString(),
  });
  saveGuestMeta(c);
  return importTxns(c.id, days);
}

/** Бэкфилл одного гостя по телефону. */
export async function backfillGuest(
  phone: string,
  days = 365,
): Promise<BackfillResult> {
  try {
    const c = await getCustomerByPhone(phone);
    if (!c) return { phone, status: "not_found" };
    const imported = await backfillCustomer(c, days);
    return { phone, status: "ok", guestId: c.id, checksImported: imported };
  } catch (e) {
    return { phone, status: "error", error: (e as Error).message };
  }
}

/**
 * Бэкфилл гостя по iiko-id (из вебхука). Не требует телефона в чеке — берёт
 * данные через customer/info по id. Без пересчёта недель (делается отдельно).
 */
export async function backfillGuestById(
  iikoId: string,
  days = 365,
): Promise<BackfillResult> {
  try {
    const c = await getCustomerById(iikoId);
    if (!c) return { phone: iikoId, status: "not_found" };
    const imported = await backfillCustomer(c, days);
    return { phone: c.phone ?? iikoId, status: "ok", guestId: c.id, checksImported: imported };
  } catch (e) {
    return { phone: iikoId, status: "error", error: (e as Error).message };
  }
}

/** Бэкфилл нескольких гостей по id + пересчёт недель окна. */
export async function backfillManyById(
  ids: string[],
  days = 365,
): Promise<{ results: BackfillResult[]; weeksRebuilt: string[] }> {
  const results: BackfillResult[] = [];
  for (const id of ids) results.push(await backfillGuestById(id, days));
  return { results, weeksRebuilt: rebuildWindow(days) };
}

/** Известен ли гость админке (уже бэкфиллен). */
export function isGuestKnown(iikoId: string): boolean {
  return !!db.prepare("SELECT 1 FROM guests WHERE iikoId = ?").get(iikoId);
}

/**
 * Гарантировать, что гость залит в аналитику (для авто-подтягивания при входе
 * в mini-app). Если уже известен — ничего не делает (вебхук держит свежесть).
 * Иначе фоново: импорт года + пересчёт ТОЛЬКО его недель (эффективно).
 * Возвращает число импортированных чеков (0, если гость уже был).
 */
export async function ensureGuestBackfilled(
  iikoId: string,
  phone?: string | null,
): Promise<number> {
  // Гость мог быть залит из «Журнала операций» под ключом-телефоном —
  // подцепляем его историю к настоящему iikoId.
  if (phone) mergeGuestIdentity(iikoId, phone);
  if (isGuestKnown(iikoId)) return 0;
  const c = await getCustomerById(iikoId);
  if (!c) return 0;
  if (phone && !c.phone) c.phone = phone;
  const imported = await backfillCustomer(c, 365);
  // Пересчитываем только недели, в которых у гостя есть чеки.
  const weeks = new Set(
    (db
      .prepare(
        "SELECT DISTINCT date FROM orders_daily WHERE guestIikoId = ?",
      )
      .all(iikoId) as { date: string }[]).map((r) => weekStart(new Date(r.date + "T00:00:00Z"))),
  );
  for (const ws of weeks) rebuildWeek(ws);
  return imported;
}

/** Пересчёт всех недель окна последних `days` дней. */
function rebuildWindow(days: number): string[] {
  const weeksRebuilt: string[] = [];
  const nWeeks = Math.min(Math.ceil(days / 7) + 1, 60);
  const cur = currentWeekStart();
  const first = weekStart(new Date(Date.now() - days * 86_400_000));
  for (let ws = first; ws <= cur; ws = addWeeks(ws, 1)) {
    rebuildWeek(ws);
    weeksRebuilt.push(ws);
    if (weeksRebuilt.length > nWeeks) break;
  }
  return weeksRebuilt;
}

/**
 * Параметры пула. Держим их щадящими: массовый всплеск запросов к iiko приводит
 * к бану нашего IP на уровне TCP (DDoS-защита api-ru.iiko.services). Поэтому —
 * низкий параллелизм, пауза между запросами, лимит резолвов на прогон (база
 * сходится за несколько ночей) и circuit breaker: при серии connect-ошибок
 * прогон прерывается, чтобы не углублять бан.
 */
export const REFRESH = {
  /** Сколько phone-гостей резолвим за один прогон (спред на много ночей). */
  resolveCap: 150,
  /** Параллелизм запросов к iiko. */
  concurrency: 2,
  /** Пауза воркера между запросами, мс. */
  spacingMs: 150,
  /** Подряд идущих connect-ошибок, после которых прогон прерываем. */
  breakerLimit: 5,
} as const;

/** Отказ на уровне соединения (iiko отрубил IP), а не прикладная ошибка. */
function isConnError(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    (e as Error)?.message === "fetch failed"
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ошибка-сигнал: сработал circuit breaker (iiko банит IP), прогон прерван. */
export class ThrottledError extends Error {
  constructor() {
    super("iiko_throttled");
  }
}

/**
 * Общий воркер-пул с паузой и circuit breaker. `job` возвращает `true`, если
 * запрос дошёл (сбрасывает счётчик connect-ошибок). Бросает ThrottledError,
 * если подряд накопилось `breakerLimit` connect-ошибок.
 */
async function runPool<T>(
  items: T[],
  job: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let consecConnErr = 0;
  let tripped = false;
  const worker = async () => {
    while (cursor < items.length && !tripped) {
      const item = items[cursor++];
      try {
        await job(item);
        consecConnErr = 0;
      } catch (e) {
        if (isConnError(e)) {
          if (++consecConnErr >= REFRESH.breakerLimit) tripped = true;
        } else {
          consecConnErr = 0; // прикладная ошибка (400/404) — бан ни при чём
        }
      }
      await sleep(REFRESH.spacingMs);
    }
  };
  await Promise.all(
    Array.from({ length: REFRESH.concurrency }, () => worker()),
  );
  if (tripped) throw new ThrottledError();
}

/**
 * Резолв гостей из «Журнала операций» (ключ `phone:<номер>`) в реальные
 * iiko-id. Транзакции iiko отдаёт по customer-id, не по телефону, поэтому по
 * синтетическому ключу пул падает в 400. Здесь по каждому телефону спрашиваем
 * customer/info → получаем настоящий id → сливаем историю (mergeGuestIdentity).
 * После этого гость становится «реальным» и попадает в обычный пул транзакций.
 *
 * Берём не более `resolveCap` номеров за прогон и идём щадяще — база сходится
 * за несколько ночей, зато без риска бана IP. Бросает ThrottledError, если
 * iiko начал резать соединения (прогон прерван, шаг транзакций не запускаем).
 */
export async function resolvePhoneGuests(): Promise<{
  total: number;
  resolved: number;
  unresolved: number;
}> {
  const total = (
    db
      .prepare(
        "SELECT COUNT(*) c FROM guests WHERE iikoId LIKE 'phone:%' AND phone IS NOT NULL",
      )
      .get() as { c: number }
  ).c;
  const rows = db
    .prepare(
      "SELECT phone FROM guests WHERE iikoId LIKE 'phone:%' AND phone IS NOT NULL LIMIT ?",
    )
    .all(REFRESH.resolveCap) as { phone: string }[];

  const weeks = new Set<string>();
  let resolved = 0;
  let unresolved = 0;
  try {
    await runPool(rows, async ({ phone }) => {
      const c = await getCustomerByPhone(phone);
      if (c) {
        // Пересчёт недель откладываем — сделаем один раз после всех слияний.
        mergeGuestIdentity(c.id, phone, weeks);
        saveGuestMeta(c);
        resolved++;
      } else {
        unresolved++;
      }
    });
  } finally {
    // Успевшие слияния фиксируем даже при обрыве по throttle.
    for (const ws of weeks) rebuildWeek(ws);
  }
  return { total, resolved, unresolved };
}

/**
 * Плановое обновление БЕЗ вебхука. Два шага:
 *  1) резолвим часть phone-гостей журнала в реальные id (resolvePhoneGuests);
 *  2) для всех гостей с реальным id подтягиваем чеки за `days` дней (дедуп по
 *     id транзакции) и пересчитываем недели окна.
 * Так лояльность остаётся свежей по всей базе, не завися от push-вебхука iiko.
 *
 * Оба шага идут через runPool (низкий параллелизм + circuit breaker). Если iiko
 * начал резать соединения, шаг помечается throttled и прогон корректно
 * сворачивается, не углубляя бан IP.
 */
export async function refreshRecent(days = 14): Promise<{
  guests: number;
  imported: number;
  errors: number;
  weeksRebuilt: string[];
  resolved: number;
  unresolved: number;
  throttled: boolean;
}> {
  let throttled = false;

  // Шаг 1: сводим phone-гостей журнала к настоящим id, иначе транзакции по ним
  // не тянутся (customer/transactions работает по id, не по телефону).
  let res = { resolved: 0, unresolved: 0 };
  try {
    res = await resolvePhoneGuests();
  } catch (e) {
    if (e instanceof ThrottledError) throttled = true;
    else throw e;
  }

  // Если уже забанены — не трогаем шаг транзакций, дадим IP остыть.
  if (throttled) {
    return {
      guests: 0,
      imported: 0,
      errors: 0,
      weeksRebuilt: [],
      resolved: res.resolved,
      unresolved: res.unresolved,
      throttled,
    };
  }

  // Шаг 2: гости с реальным iiko-id (после резолва — практически вся база).
  const ids = (
    db
      .prepare("SELECT iikoId FROM guests WHERE iikoId NOT LIKE 'phone:%'")
      .all() as { iikoId: string }[]
  ).map((r) => r.iikoId);

  let imported = 0;
  let errors = 0;
  try {
    await runPool(ids, async (id) => {
      try {
        imported += await importTxns(id, days);
      } catch (e) {
        if (isConnError(e)) throw e; // отдаём breaker'у
        errors++; // прикладная ошибка по гостю — не связана с баном
      }
    });
  } catch (e) {
    if (e instanceof ThrottledError) throttled = true;
    else throw e;
  }

  const weeksRebuilt = rebuildWindow(days);
  return {
    guests: ids.length,
    imported,
    errors,
    weeksRebuilt,
    resolved: res.resolved,
    unresolved: res.unresolved,
    throttled,
  };
}

/** Бэкфилл списка телефонов + пересчёт последних N недель. */
export async function backfillMany(
  phones: string[],
  days = 365,
): Promise<{ results: BackfillResult[]; weeksRebuilt: string[] }> {
  const results: BackfillResult[] = [];
  for (const p of phones) {
    results.push(await backfillGuest(p, days));
  }
  return { results, weeksRebuilt: rebuildWindow(days) };
}
