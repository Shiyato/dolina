import { db } from "./db.js";
import { rebuildWeek } from "./aggregate.js";
import { phoneKey } from "./identity.js";
import { addWeeks, weekStart } from "./weeks.js";

/**
 * Импорт «Журнала операций» из iikoWeb (выгрузка .xlsx → JSON).
 *
 * Зачем: iiko не отдаёт список заказов POS через Transport API, а вебхуки
 * копят данные только вперёд. Журнал — единственный способ получить историю.
 * Берём строки «Закрытие заказа»: дата, телефон, ФИО, сумма чека.
 *
 * Гость в журнале известен только по телефону. Резолвить каждый из тысяч
 * номеров через customer/info нельзя — iiko режет такую пачку по лимитам.
 * Поэтому: телефон, уже встречавшийся в guests, ложится под свой реальный
 * iikoId, а незнакомый — под синтетический ключ `phone:<номер>`. Настоящий id
 * подцепится сам при первом вебхуке/входе в mini-app (см. mergeGuestIdentity).
 */

export interface JournalOrder {
  /** Локальная дата чека YYYY-MM-DD. */
  date: string;
  /** Телефон в формате +7XXXXXXXXXX. */
  phone: string;
  /** Сумма чека, ₽. */
  sum: number;
}

export interface JournalGuest {
  phone: string;
  name: string;
}

export interface ImportResult {
  orders: number;
  guests: number;
  /** Телефонов, легших под уже известный реальный iikoId. */
  known: number;
  /** Телефонов под синтетическим ключом (ждут вебхука/входа для слияния). */
  pending: number;
  weeksRebuilt: number;
  from: string;
  to: string;
}

/**
 * Телефон → ключ гостя. Реальный iikoId берём, только если этот телефон уже
 * встречался (вебхук/mini-app), иначе — синтетический ключ. Всё локально.
 */
function keyByPhone(phones: string[]): {
  map: Map<string, string>;
  known: number;
  pending: number;
} {
  const rows = db
    .prepare("SELECT iikoId, phone FROM guests WHERE phone IS NOT NULL")
    .all() as { iikoId: string; phone: string }[];
  const real = new Map(rows.filter((r) => !r.iikoId.startsWith("phone:")).map((r) => [r.phone, r.iikoId]));

  const map = new Map<string, string>();
  let known = 0;
  let pending = 0;
  for (const p of phones) {
    const id = real.get(p);
    if (id) {
      map.set(p, id);
      known++;
    } else {
      map.set(p, phoneKey(p));
      pending++;
    }
  }
  return { map, known, pending };
}

const upsertGuest = db.prepare(`
  INSERT INTO guests (iikoId, phone, name, surname, firstSeen, lastSeen)
  VALUES (@iikoId, @phone, @name, '', @ts, @ts)
  ON CONFLICT(iikoId) DO UPDATE SET
    phone = COALESCE(excluded.phone, guests.phone),
    name  = COALESCE(NULLIF(excluded.name, ''), guests.name)
`);
const insDaily = db.prepare(`
  INSERT INTO orders_daily (date, guestIikoId, ordersCount, ordersSum)
  VALUES (@date, @guestIikoId, @count, @sum)
  ON CONFLICT(date, guestIikoId) DO UPDATE SET
    ordersCount = excluded.ordersCount,
    ordersSum   = excluded.ordersSum
`);

/**
 * Залить журнал. Журнал — источник истины за свой период: строки orders_daily
 * в этом диапазоне перезаписываются целиком, поэтому повторный импорт и
 * пересечение с прежним бэкфиллом по транзакциям не задваивают чеки.
 */
export function importJournal(input: {
  orders: JournalOrder[];
  guests: JournalGuest[];
}): ImportResult {
  const orders = input.orders.filter((o) => o.date && o.phone);
  if (!orders.length) throw new Error("journal_empty");

  const dates = orders.map((o) => o.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  const phones = [...new Set(orders.map((o) => o.phone))];
  const { map, known, pending } = keyByPhone(phones);

  // Агрегируем чеки по (дата, гость).
  const daily = new Map<string, { date: string; guestIikoId: string; count: number; sum: number }>();
  for (const o of orders) {
    const guestIikoId = map.get(o.phone)!;
    const key = o.date + "|" + guestIikoId;
    const cur = daily.get(key) ?? { date: o.date, guestIikoId, count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += o.sum;
    daily.set(key, cur);
  }

  const nameByPhone = new Map(input.guests.map((g) => [g.phone, g.name]));

  const tx = db.transaction(() => {
    // Журнал перекрывает период целиком — старые агрегаты за него убираем.
    db.prepare("DELETE FROM orders_daily WHERE date >= ? AND date <= ?").run(from, to);
    for (const phone of phones) {
      upsertGuest.run({
        iikoId: map.get(phone)!,
        phone,
        name: nameByPhone.get(phone) ?? "",
        ts: new Date().toISOString(),
      });
    }
    for (const d of daily.values()) insDaily.run(d);
  });
  tx();

  // Пересчёт всех недель периода (+1 неделя вперёд: задачи сравнивают с прошлой).
  let weeksRebuilt = 0;
  const last = weekStart(new Date(to + "T00:00:00Z"));
  for (let ws = weekStart(new Date(from + "T00:00:00Z")); ws <= last; ws = addWeeks(ws, 1)) {
    rebuildWeek(ws);
    weeksRebuilt++;
  }

  return {
    orders: orders.length,
    guests: phones.length,
    known,
    pending,
    weeksRebuilt,
    from,
    to,
  };
}
