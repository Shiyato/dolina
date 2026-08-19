import crypto from "node:crypto";
import { db } from "./db.js";
import { classify } from "./favorites.js";
import { isRestoConfigured, olapColumns, runOlap } from "../iikoServer.js";

/**
 * Автоматическое формирование «любимых блюд» гостя из OLAP-отчёта продаж.
 *
 * Идея: любой отчёт, где есть поле ГОСТЬ и поле БЛЮДО (и, желательно,
 * количество), — это готовый «кто что купил». Раскладываем его строки в
 * guest_items (тот же источник, что читают панель 🔥 и задачи «любимое из
 * меню»), сопоставляя гостя из отчёта с нашим гостем.
 *
 * Идемпотентность: пишем с SET-семантикой (не += ), productId синтезируем из
 * названия блюда. Поэтому повторный запуск того же отчёта не задваивает, а
 * «перезаписывает» — отчёт за окно считается источником истины по этому окну.
 */

type Row = Record<string, unknown>;

export interface FavoritesIngestResult {
  /** Найдены ли поля гость+блюдо (иначе отчёт не про покупки — пропускаем). */
  applicable: boolean;
  guestField?: string;
  dishField?: string;
  amountField?: string;
  /** Уникальных гостей, которых удалось сопоставить с нашей базой. */
  matchedGuests: number;
  /** Строк отчёта с гостем, которого не нашли у нас. */
  unmatched: number;
  /** Записей позиций, залитых в guest_items. */
  ingested: number;
}

/** Подобрать имя поля по FieldName или по русскому названию колонки. */
function pickField(
  columns: { field: string; name: string }[],
  fieldRe: RegExp,
  nameRe: RegExp,
): string | undefined {
  return (
    columns.find((c) => fieldRe.test(c.field))?.field ??
    columns.find((c) => nameRe.test(c.name))?.field
  );
}

/** Нормализация телефона к +7XXXXXXXXXX (для сопоставления). */
function normPhone(s: string): string | null {
  const d = s.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return "+7" + d.slice(1);
  if (d.length === 10) return "+7" + d;
  return null;
}

/** Стабильный productId для блюда из OLAP (нет реального id — синтезируем). */
function dishId(name: string): string {
  return "olap:" + crypto.createHash("sha1").update(name.toLowerCase().trim()).digest("hex").slice(0, 16);
}

/**
 * Разрешить «гостя» из отчёта в наш guestIikoId. Стратегии по убыванию
 * надёжности: точный iiko-id → карта → телефон → «Имя Фамилия».
 */
function resolveGuest(value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  // 1) уже реальный iiko-id
  const byId = db.prepare("SELECT iikoId FROM guests WHERE iikoId = ?").get(v) as
    | { iikoId: string }
    | undefined;
  if (byId) return byId.iikoId;

  // 2) номер карты
  const byCard = db
    .prepare("SELECT iikoId FROM guests WHERE cardTrack = ? AND iikoId NOT LIKE 'phone:%'")
    .get(v) as { iikoId: string } | undefined;
  if (byCard) return byCard.iikoId;

  // 3) телефон
  const phone = normPhone(v);
  if (phone) {
    const byPhone = db
      .prepare("SELECT iikoId FROM guests WHERE phone = ? ORDER BY (iikoId LIKE 'phone:%') LIMIT 1")
      .get(phone) as { iikoId: string } | undefined;
    if (byPhone) return byPhone.iikoId;
  }

  // 4) «Имя Фамилия» (или «Фамилия Имя») — слабое, но лучше, чем ничего
  const byName = db
    .prepare(
      `SELECT iikoId FROM guests
       WHERE iikoId NOT LIKE 'phone:%'
         AND (TRIM(COALESCE(name,'')||' '||COALESCE(surname,'')) = ?
           OR TRIM(COALESCE(surname,'')||' '||COALESCE(name,'')) = ?)
       LIMIT 1`,
    )
    .get(v, v) as { iikoId: string } | undefined;
  return byName?.iikoId ?? null;
}

const upsertItem = db.prepare(`
  INSERT INTO guest_items (guestIikoId, productId, name, kind, qty, orders, lastSeen)
  VALUES (@guestIikoId, @productId, @name, @kind, @qty, @orders, @ts)
  ON CONFLICT(guestIikoId, productId) DO UPDATE SET
    qty      = excluded.qty,
    orders   = excluded.orders,
    name     = excluded.name,
    kind     = excluded.kind,
    lastSeen = excluded.lastSeen
`);

/**
 * Залить «любимое» из строк OLAP-отчёта. Безопасно вызывать на любом отчёте:
 * если нет полей гость+блюдо, возвращает applicable=false и ничего не пишет.
 */
export function ingestFavoritesFromOlap(
  rows: Row[],
  columns: { field: string; name: string }[],
): FavoritesIngestResult {
  const guestField = pickField(
    columns,
    /guest|customer|card|client/i,
    /гост|карт|клиент/i,
  );
  const dishField = pickField(columns, /dish|product/i, /блюд|товар|продукт|номенклат/i);
  const amountField = pickField(columns, /amount|count|qty/i, /кол-?во|количест/i);

  if (!guestField || !dishField) {
    return { applicable: false, matchedGuests: 0, unmatched: 0, ingested: 0 };
  }

  const matched = new Set<string>();
  let unmatched = 0;
  let ingested = 0;
  const ts = new Date().toISOString();

  const tx = db.transaction(() => {
    for (const r of rows) {
      const guestVal = String(r[guestField] ?? "").trim();
      const dishVal = String(r[dishField] ?? "").trim();
      if (!guestVal || !dishVal) continue;

      const guestIikoId = resolveGuest(guestVal);
      if (!guestIikoId) {
        unmatched++;
        continue;
      }
      matched.add(guestIikoId);

      const qtyRaw = amountField ? Number(r[amountField]) : 1;
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      const kind = classify(dishVal);
      if (kind === "other") continue; // в «любимое» идут только напитки и блюда

      upsertItem.run({
        guestIikoId,
        productId: dishId(dishVal),
        name: dishVal,
        kind,
        qty,
        orders: Math.max(1, Math.round(qty)),
        ts,
      });
      ingested++;
    }
  });
  tx();

  return {
    applicable: true,
    guestField,
    dishField,
    amountField,
    matchedGuests: matched.size,
    unmatched,
    ingested,
  };
}

/** YYYY-MM-DD n дней назад (UTC). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Автоматическое обновление «любимого» из OLAP — без участия человека.
 * Сама берёт список полей SALES, подбирает гость+блюдо+количество, запускает
 * отчёт за последние `days` дней и раскладывает в guest_items. Ничего не делает,
 * если доступы к iikoServer не заданы. Зовётся из ночного крона.
 */
export async function autoRefreshFavorites(
  days = 90,
): Promise<FavoritesIngestResult & { skipped?: boolean }> {
  if (!isRestoConfigured()) {
    return { applicable: false, matchedGuests: 0, unmatched: 0, ingested: 0, skipped: true };
  }
  const cols = await olapColumns("SALES");
  const guestField = pickField(cols, /guest|customer|card|client/i, /гост|карт|клиент/i);
  const dishField = pickField(cols, /dish|product/i, /блюд|товар|продукт|номенклат/i);
  const amountField = pickField(cols, /amount|count|qty/i, /кол-?во|количест/i);
  if (!guestField || !dishField) {
    return { applicable: false, matchedGuests: 0, unmatched: 0, ingested: 0 };
  }
  const rows = await runOlap({
    reportType: "SALES",
    groupByRowFields: [guestField, dishField],
    aggregateFields: amountField ? [amountField] : [],
    from: daysAgo(days),
    to: daysAgo(0),
  });
  return ingestFavoritesFromOlap(
    rows,
    [guestField, dishField, amountField].filter(Boolean).map((f) => ({ field: f as string, name: f as string })),
  );
}
