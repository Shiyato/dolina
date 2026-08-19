import { db } from "./db.js";
import { parseCheckItems, recordItems, type CheckItem } from "./favorites.js";
import { mergeGuestIdentity } from "./identity.js";

/**
 * Приём закрытых чеков (из вебхуков iiko TableOrderUpdate / DeliveryOrderUpdate)
 * → агрегат по гостю за день (orders_daily) + база гостей (guests).
 *
 * Формат eventInfo iiko варьируется; извлекаем максимально терпимо. Точный
 * маппинг уточняется по первому реальному событию (лог в webhook-роуте).
 */

export interface ClosedCheck {
  orderId: string;
  guestIikoId: string;
  phone: string | null;
  name: string | null;
  surname: string | null;
  /** Сумма чека, ₽. */
  sum: number;
  /** Локальная дата чека YYYY-MM-DD. */
  date: string;
  /** Позиции чека (для «любимого напитка/блюда»). */
  items: CheckItem[];
}

const insertProcessed = db.prepare(
  "INSERT OR IGNORE INTO processed_orders (orderId, whenSeen) VALUES (?, ?)",
);
const upsertDaily = db.prepare(`
  INSERT INTO orders_daily (date, guestIikoId, ordersCount, ordersSum)
  VALUES (@date, @guestIikoId, 1, @sum)
  ON CONFLICT(date, guestIikoId) DO UPDATE SET
    ordersCount = ordersCount + 1,
    ordersSum   = ordersSum + @sum
`);
const upsertGuest = db.prepare(`
  INSERT INTO guests (iikoId, phone, name, surname, firstSeen, lastSeen)
  VALUES (@guestIikoId, @phone, @name, @surname, @ts, @ts)
  ON CONFLICT(iikoId) DO UPDATE SET
    phone    = COALESCE(excluded.phone, guests.phone),
    name     = COALESCE(excluded.name, guests.name),
    surname  = COALESCE(excluded.surname, guests.surname),
    lastSeen = excluded.lastSeen
`);

export interface IngestResult {
  /** Чек новый (не дубль). */
  newOrder: boolean;
  /** Гость впервые появился в базе (кандидат на авто-бэкфилл истории). */
  newGuest: boolean;
}

const guestExists = db.prepare("SELECT 1 FROM guests WHERE iikoId = ?");

/** Записать закрытый чек (идемпотентно по orderId). */
export function ingestCheck(c: ClosedCheck): IngestResult {
  const tx = db.transaction((chk: ClosedCheck): IngestResult => {
    const info = insertProcessed.run(chk.orderId, new Date().toISOString());
    if (info.changes === 0) return { newOrder: false, newGuest: false };
    const isNewGuest = !guestExists.get(chk.guestIikoId);
    upsertDaily.run({ date: chk.date, guestIikoId: chk.guestIikoId, sum: chk.sum });
    upsertGuest.run({
      guestIikoId: chk.guestIikoId,
      phone: chk.phone,
      name: chk.name,
      surname: chk.surname,
      ts: new Date().toISOString(),
    });
    return { newOrder: true, newGuest: isNewGuest };
  });
  const result = tx(c) as IngestResult;
  // Позиции — только для новых чеков, иначе задвоим статистику.
  if (result.newOrder) recordItems(c.guestIikoId, c.items);
  // Гость мог быть залит из журнала под ключом-телефоном — сливаем историю.
  if (result.newGuest && c.phone) mergeGuestIdentity(c.guestIikoId, c.phone);
  return result;
}

/** yyyy-mm-dd из ISO/строки iiko; today по умолчанию. */
function toDate(s: unknown): string {
  const str = String(s ?? "");
  const m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Разбор одного webhook-события iiko в ClosedCheck.
 * Формат — по официальной OpenAPI-спеке (docs/iiko-openapi.json):
 *   { eventType, eventTime, eventInfo: { id, posId, order: TableOrder } }
 *   TableOrder: { customer{id,name,surname}, phone (НА УРОВНЕ ЗАКАЗА!),
 *                 status: New|Bill|Closed|Deleted, sum, whenClosed, … }
 * Возвращает null, если это не закрытый чек с гостем.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseWebhookEvent(ev: any): ClosedCheck | null {
  const type = ev?.eventType;
  if (type !== "TableOrderUpdate" && type !== "DeliveryOrderUpdate") return null;
  const info = ev?.eventInfo ?? {};
  const order = info?.order ?? info;
  // Интересует только закрытый заказ.
  const status = order?.status ?? info?.status;
  if (status && String(status).toLowerCase() !== "closed") return null;

  const customer = order?.customer ?? info?.customer ?? {};
  const guestIikoId = customer?.id ?? order?.customerId ?? null;
  if (!guestIikoId) return null; // без гостя — в аналитику не попадает

  // ID заказа: TableOrder своего id не имеет — берём eventInfo.id / posId.
  const orderId = info?.id ?? info?.posId ?? order?.id ?? ev?.correlationId;
  const sum = Number(order?.sum ?? order?.orderSum ?? info?.sum ?? 0) || 0;
  const date = toDate(order?.whenClosed ?? order?.closeDate ?? ev?.eventTime);

  return {
    orderId: String(orderId),
    guestIikoId: String(guestIikoId),
    // Телефон — на уровне заказа (по спеке); customer.phone как фолбэк.
    phone: order?.phone ?? customer?.phone ?? null,
    name: customer?.name ?? null,
    surname: customer?.surname ?? null,
    sum,
    date,
    items: parseCheckItems(order?.items ?? info?.items),
  };
}
