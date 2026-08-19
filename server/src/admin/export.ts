import ExcelJS from "exceljs";
import { db } from "./db.js";
import { addWeeks, isoWeekNumber, segmentLabel } from "./weeks.js";

/** Аналитика недели → .xlsx (буфер). */
export async function analyticsXlsx(week: string): Promise<Buffer> {
  const prev = addWeeks(week, -1);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Неделя ${isoWeekNumber(week)}`);
  ws.columns = [
    { header: "Сегмент визитов", key: "seg", width: 16 },
    { header: "Прошлая нед. гостей", key: "pg", width: 18 },
    { header: "Прошлая нед. чеков", key: "pc", width: 18 },
    { header: "Текущая нед. гостей", key: "cg", width: 18 },
    { header: "Текущая нед. чеков", key: "cc", width: 18 },
    { header: "Динамика гостей", key: "dg", width: 16 },
    { header: "Динамика гостей, %", key: "dgp", width: 18 },
    { header: "Динамика чеков", key: "dc", width: 16 },
    { header: "Динамика чеков, %", key: "dcp", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };

  const segRow = (w: string, seg: string) =>
    (db
      .prepare("SELECT guests, checks FROM week_segment WHERE weekStart=? AND segment=?")
      .get(w, seg) as { guests: number; checks: number } | undefined) ?? {
      guests: 0,
      checks: 0,
    };
  const pct = (c: number, p: number) =>
    p === 0 ? (c === 0 ? "0%" : "100%") : `${Math.round(((c - p) / p) * 100)}%`;

  for (const seg of ["7", "6", "5", "4", "3", "2", "1", "total"]) {
    const c = segRow(week, seg);
    const p = segRow(prev, seg);
    ws.addRow({
      seg: seg === "total" ? "Итого" : segmentLabel(seg),
      pg: p.guests,
      pc: p.checks,
      cg: c.guests,
      cc: c.checks,
      dg: c.guests - p.guests,
      dgp: pct(c.guests, p.guests),
      dc: c.checks - p.checks,
      dcp: pct(c.checks, p.checks),
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Задачи недели → .xlsx (буфер). */
export async function tasksXlsx(week: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Задания ${isoWeekNumber(week)}`);
  ws.columns = [
    { header: "Когорта", key: "cohort", width: 12 },
    { header: "Имя", key: "name", width: 24 },
    { header: "Телефон", key: "phone", width: 16 },
    { header: "Кэшбек", key: "cashback", width: 18 },
    { header: "Любимый напиток", key: "drink", width: 26 },
    { header: "Любимое блюдо", key: "food", width: 26 },
    { header: "Что упало", key: "reason", width: 40 },
    { header: "Выполнено", key: "done", width: 12 },
    { header: "Кто выполнил", key: "by", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  // Порядок как на экране: 5+ → 2–4 → 1 (обычный ORDER BY дал бы 1, 2–4, 5+).
  const rows = db
    .prepare(
      `SELECT * FROM tasks WHERE weekStart = ?
       ORDER BY CASE cohort WHEN '5plus' THEN 0 WHEN '2-4' THEN 1 ELSE 2 END, id`,
    )
    .all(week) as {
    cohort: string;
    guestName: string | null;
    guestPhone: string | null;
    reason: string;
    done: number;
    doneByName: string | null;
    favoriteDrink: string | null;
    favoriteFood: string | null;
    cashbackCategory: string | null;
  }[];
  const label: Record<string, string> = { "5plus": "5+", "2-4": "2–4", "1": "1" };
  for (const r of rows) {
    ws.addRow({
      cohort: label[r.cohort] ?? r.cohort,
      name: r.guestName ?? "—",
      phone: r.guestPhone ?? "—",
      cashback: r.cashbackCategory ?? "—",
      drink: r.favoriteDrink ?? "—",
      food: r.favoriteFood ?? "—",
      reason: r.reason,
      done: r.done ? "да" : "нет",
      by: r.doneByName ?? "",
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Гости сегмента «1 визит» выбранной недели с телефонами → .xlsx (буфер).
 * Для SMS-рассылки новым гостям: имя + телефон + сумма единственного чека.
 */
export async function leadsXlsx(week: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`1 визит, нед. ${isoWeekNumber(week)}`);
  ws.columns = [
    { header: "Имя", key: "name", width: 26 },
    { header: "Телефон", key: "phone", width: 18 },
    { header: "Кэшбек", key: "cashback", width: 18 },
    { header: "Визитов за 30 дн.", key: "visits", width: 18 },
    { header: "Сумма чеков, ₽", key: "sum", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  // Сегмент «1» за неделю + телефон гостя (без телефона в SMS смысла нет).
  const rows = db
    .prepare(
      `SELECT g.name AS name, g.surname AS surname, g.phone AS phone,
              g.category AS category, wg.visits30d AS visits, wg.ordersSum AS sum
       FROM week_guest wg
       JOIN guests g ON g.iikoId = wg.guestIikoId
       WHERE wg.weekStart = ? AND wg.segment = 1 AND g.phone IS NOT NULL AND g.phone <> ''
       ORDER BY g.name`,
    )
    .all(week) as {
    name: string | null;
    surname: string | null;
    phone: string;
    category: string | null;
    visits: number;
    sum: number;
  }[];
  for (const r of rows) {
    ws.addRow({
      name: [r.name, r.surname].filter(Boolean).join(" ") || "Гость",
      phone: r.phone,
      cashback: r.category ?? "—",
      visits: r.visits,
      sum: Math.round(r.sum),
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
