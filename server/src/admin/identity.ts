import { db } from "./db.js";
import { rebuildWeek } from "./aggregate.js";
import { weekStart } from "./weeks.js";

/**
 * Сведение личностей гостя.
 *
 * Импорт «Журнала операций» знает гостя только по телефону и кладёт его под
 * синтетическим ключом `phone:+7XXXXXXXXXX` (обращаться в iiko за id на каждый
 * из тысяч телефонов нельзя — упирается в лимиты). Настоящий iikoId приходит
 * позже: с вебхуком закрытия чека или при входе гостя в mini-app.
 *
 * В этот момент сливаем историю: переносим чеки, позиции и задачи с
 * синтетического ключа на настоящий и удаляем временную запись.
 */

/** Синтетический ключ гостя, известного только по телефону. */
export function phoneKey(phone: string): string {
  return "phone:" + phone;
}

/**
 * Слить историю с `phone:<номер>` на реальный iikoId.
 * Возвращает число перенесённых дней с чеками (0 — сливать было нечего).
 *
 * `deferWeeks`: при массовой миграции (резолв всей базы) передайте общий Set —
 * затронутые недели складываются в него, а пересчёт делает вызывающий один раз,
 * а не по разу на каждого гостя.
 */
export function mergeGuestIdentity(
  realIikoId: string,
  phone: string | null,
  deferWeeks?: Set<string>,
): number {
  if (!phone || !realIikoId) return 0;
  const legacy = phoneKey(phone);
  if (legacy === realIikoId) return 0;

  const exists = db.prepare("SELECT 1 FROM guests WHERE iikoId = ?").get(legacy);
  if (!exists) return 0;

  // Недели, которые придётся пересчитать после переноса.
  const dates = (
    db
      .prepare("SELECT DISTINCT date FROM orders_daily WHERE guestIikoId = ?")
      .all(legacy) as { date: string }[]
  ).map((r) => r.date);

  const tx = db.transaction(() => {
    // Чеки: складываем, если на ту же дату уже есть записи под реальным id.
    db.prepare(
      `INSERT INTO orders_daily (date, guestIikoId, ordersCount, ordersSum)
       SELECT date, ?, ordersCount, ordersSum FROM orders_daily WHERE guestIikoId = ?
       ON CONFLICT(date, guestIikoId) DO UPDATE SET
         ordersCount = ordersCount + excluded.ordersCount,
         ordersSum   = ordersSum   + excluded.ordersSum`,
    ).run(realIikoId, legacy);
    db.prepare("DELETE FROM orders_daily WHERE guestIikoId = ?").run(legacy);

    // Позиции чеков (любимые напиток/блюдо).
    db.prepare(
      `INSERT INTO guest_items (guestIikoId, productId, name, kind, qty, orders, lastSeen)
       SELECT ?, productId, name, kind, qty, orders, lastSeen
       FROM guest_items WHERE guestIikoId = ?
       ON CONFLICT(guestIikoId, productId) DO UPDATE SET
         qty    = qty + excluded.qty,
         orders = orders + excluded.orders`,
    ).run(realIikoId, legacy);
    db.prepare("DELETE FROM guest_items WHERE guestIikoId = ?").run(legacy);

    // Задачи перецепляем, недельные снимки пересчитаются заново.
    db.prepare("UPDATE tasks SET guestIikoId = ? WHERE guestIikoId = ?").run(
      realIikoId,
      legacy,
    );
    db.prepare("DELETE FROM week_guest WHERE guestIikoId = ?").run(legacy);

    // Карточка гостя: имя/телефон из журнала не теряем.
    db.prepare(
      `INSERT INTO guests (iikoId, phone, name, surname, firstSeen, lastSeen)
       SELECT ?, phone, name, surname, firstSeen, lastSeen FROM guests WHERE iikoId = ?
       ON CONFLICT(iikoId) DO UPDATE SET
         phone = COALESCE(guests.phone, excluded.phone),
         name  = COALESCE(NULLIF(guests.name, ''), excluded.name)`,
    ).run(realIikoId, legacy);
    db.prepare("DELETE FROM guests WHERE iikoId = ?").run(legacy);
  });
  tx();

  // Пересчитываем только затронутые недели (или откладываем на вызывающего).
  const weeks = new Set(dates.map((d) => weekStart(new Date(d + "T00:00:00Z"))));
  if (deferWeeks) {
    for (const ws of weeks) deferWeeks.add(ws);
  } else {
    for (const ws of weeks) rebuildWeek(ws);
  }
  return dates.length;
}
