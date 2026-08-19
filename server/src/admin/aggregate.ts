import { db } from "./db.js";
import { favoritesFor } from "./favorites.js";
import { CADENCE, findCandidates, riskReason, windowBounds } from "./cadence.js";
import { addWeeks, currentWeekStart, segmentOf, weekStartDate } from "./weeks.js";

/**
 * Недельный пересчёт: из orders_daily строим снимки по гостям (week_guest),
 * агрегат по сегментам (week_segment) и генерируем задачи (tasks) по просадке
 * относительно предыдущей недели.
 *
 * «Визиты за 30 дней» = число чеков гостя за 30 дней до конца недели.
 */

interface GuestAgg {
  guestIikoId: string;
  ordersCount: number;
  ordersSum: number;
  visits30d: number;
  segment: number;
}

/** Сумма чеков/визитов гостя в диапазоне дат [from, to] (YYYY-MM-DD, вкл.). */
function rangeAgg(from: string, to: string) {
  return db
    .prepare(
      `SELECT guestIikoId,
              SUM(ordersCount) AS cnt,
              SUM(ordersSum)   AS sum
       FROM orders_daily
       WHERE date >= ? AND date <= ?
       GROUP BY guestIikoId`,
    )
    .all(from, to) as { guestIikoId: string; cnt: number; sum: number }[];
}

/** Визиты гостя за 30 дней до `to` включительно. */
function visits30dMap(to: string): Map<string, number> {
  const toDate = new Date(to + "T00:00:00.000Z");
  const from = new Date(toDate);
  from.setUTCDate(from.getUTCDate() - 29);
  const rows = rangeAgg(from.toISOString().slice(0, 10), to);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.guestIikoId, r.cnt);
  return m;
}

/** Пересчитать снимок + сегменты + задачи для недели weekStart. */
export function rebuildWeek(weekStart: string): void {
  const wsDate = weekStartDate(weekStart);
  const weekEnd = new Date(wsDate);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const from = weekStart;
  const to = weekEnd.toISOString().slice(0, 10);

  const weekRows = rangeAgg(from, to);
  const v30 = visits30dMap(to);

  const guests: GuestAgg[] = weekRows.map((r) => {
    const visits = v30.get(r.guestIikoId) ?? r.cnt;
    return {
      guestIikoId: r.guestIikoId,
      ordersCount: r.cnt,
      ordersSum: r.sum,
      visits30d: visits,
      segment: segmentOf(visits),
    };
  });

  const tx = db.transaction(() => {
    // week_guest
    db.prepare("DELETE FROM week_guest WHERE weekStart = ?").run(weekStart);
    const insG = db.prepare(`
      INSERT INTO week_guest (weekStart, guestIikoId, visits30d, ordersCount, ordersSum, segment)
      VALUES (?,?,?,?,?,?)`);
    for (const g of guests) {
      insG.run(weekStart, g.guestIikoId, g.visits30d, g.ordersCount, g.ordersSum, g.segment);
    }

    // week_segment (по сегменту 1..7 + total)
    db.prepare("DELETE FROM week_segment WHERE weekStart = ?").run(weekStart);
    const bySeg = new Map<number, { guests: number; checks: number; sum: number }>();
    let tG = 0,
      tC = 0,
      tS = 0;
    for (const g of guests) {
      if (g.segment === 0) continue;
      const s = bySeg.get(g.segment) ?? { guests: 0, checks: 0, sum: 0 };
      s.guests += 1;
      s.checks += g.ordersCount;
      s.sum += g.ordersSum;
      bySeg.set(g.segment, s);
      tG += 1;
      tC += g.ordersCount;
      tS += g.ordersSum;
    }
    const insS = db.prepare(`
      INSERT INTO week_segment (weekStart, segment, guests, checks, sum)
      VALUES (?,?,?,?,?)`);
    for (let seg = 1; seg <= 7; seg++) {
      const s = bySeg.get(seg) ?? { guests: 0, checks: 0, sum: 0 };
      insS.run(weekStart, String(seg), s.guests, s.checks, s.sum);
    }
    insS.run(weekStart, "total", tG, tC, tS);
  });
  tx();

  // Данные недели ws — основание для задач СЛЕДУЮЩЕЙ недели (менеджер работает
  // по последней закрытой неделе). Будущее не трогаем: его данных ещё нет.
  const target = addWeeks(weekStart, 1);
  if (target <= currentWeekStart()) generateTasks(target);
}

/** Даты визитов каждого гостя в окне [from, to], по возрастанию. */
function visitDatesInWindow(from: string, to: string): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT guestIikoId, date FROM orders_daily
       WHERE date >= ? AND date <= ? AND ordersCount > 0
       ORDER BY guestIikoId, date`,
    )
    .all(from, to) as { guestIikoId: string; date: string }[];
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const arr = m.get(r.guestIikoId);
    if (arr) arr.push(r.date);
    else m.set(r.guestIikoId, [r.date]);
  }
  return m;
}

/**
 * Задачи на неделю `weekStart`. Персональные задачи (когорты 5+ и 2–4) ставим
 * на гостей «под риском»: тех, кто молчит заметно дольше своего обычного
 * интервала между визитами (см. CADENCE). Из них берём топ по тратам за окно —
 * ограниченную ёмкость обзвона тратим на самых ценных (LTV). Когорта «1» —
 * отдельная общая задача по просадке чеков сегмента.
 *
 * «Отсечка» = конец последней закрытой недели (день до weekStart): текущую,
 * недожитую неделю в расчёт не берём. Подтверждённую неделю не перегенерируем.
 */
export function generateTasks(weekStart: string): void {
  const status = db
    .prepare("SELECT confirmed FROM week_status WHERE weekStart = ?")
    .get(weekStart) as { confirmed: number } | undefined;
  if (status?.confirmed) return; // заморожено

  // Отсечка = конец последней закрытой недели, окно — назад от неё.
  const { asOf, from } = windowBounds(weekStart);
  const visitDates = visitDatesInWindow(from, asOf);
  // Ценность гостя для приоритизации — его траты за окно (прокси LTV).
  const spend = new Map<string, number>();
  for (const r of rangeAgg(from, asOf)) spend.set(r.guestIikoId, r.sum);

  // Кандидаты «под риском», отсортированы по ценности (общая логика с диагностикой).
  const candidates = findCandidates(visitDates, spend, asOf);

  // Границы кулдауна по взаимодействию.
  const contactedFrom = addWeeks(weekStart, -CADENCE.contactedCooldownWeeks);
  const listedFrom = addWeeks(weekStart, -CADENCE.listedCooldownWeeks);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM tasks WHERE weekStart = ? AND done = 0").run(weekStart);

    let placed = 0;
    for (const c of candidates) {
      if (placed >= CADENCE.maxTasks) break;

      // Уже есть задача по гостю на эту неделю (в т.ч. выполненная) — не дублируем.
      const exists = db
        .prepare("SELECT 1 FROM tasks WHERE weekStart = ? AND guestIikoId = ? LIMIT 1")
        .get(weekStart, c.guestIikoId);
      if (exists) continue;

      // Кулдаун по взаимодействию, чтобы не звонить одному гостю каждую неделю:
      //  • позвонили (done=1) — пауза contactedCooldownWeeks;
      //  • показали, но не позвонили — пауза listedCooldownWeeks (по факту показа).
      const recent = db
        .prepare(
          `SELECT 1 FROM tasks
           WHERE guestIikoId = ? AND weekStart < ?
             AND ((done = 1 AND weekStart >= ?) OR weekStart >= ?)
           LIMIT 1`,
        )
        .get(c.guestIikoId, weekStart, contactedFrom, listedFrom);
      if (recent) continue;

      const guest = db
        .prepare("SELECT name, surname, phone, category FROM guests WHERE iikoId = ?")
        .get(c.guestIikoId) as
        | { name: string; surname: string; phone: string; category: string | null }
        | undefined;

      // Любимые позиции — контекст для звонка менеджера.
      const fav = favoritesFor(c.guestIikoId);

      const reason = riskReason(c.medianGap, c.daysSince);

      db.prepare(`
        INSERT INTO tasks (weekStart, cohort, guestIikoId, guestName, guestPhone, reason, done, favoriteDrink, favoriteFood, cashbackCategory)
        VALUES (?,?,?,?,?,?,0,?,?,?)`).run(
        weekStart,
        c.cohort,
        c.guestIikoId,
        [guest?.name, guest?.surname].filter(Boolean).join(" ") || "Гость",
        guest?.phone ?? null,
        reason,
        fav.drink,
        fav.food,
        guest?.category ?? null,
      );
      placed++;
    }
    // Когорта «1» больше не создаёт авто-задачу: работа по новым гостям ведётся
    // через ручную форму блогеров/просмотров (week_segment1) на экране заданий.
  });
  tx();
}

