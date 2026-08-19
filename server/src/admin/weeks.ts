/**
 * Утилиты календарных недель (ISO 8601: неделя Пн–Вс).
 * weekStart — дата понедельника в формате YYYY-MM-DD (ключ периода).
 */

/** Понедельник недели, содержащей дату d (UTC). */
export function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Пн=0 … Вс=6
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

/** weekStart строкой YYYY-MM-DD → Date (полночь UTC). */
export function weekStartDate(ws: string): Date {
  return new Date(ws + "T00:00:00.000Z");
}

/** Сдвиг недели на n (может быть отрицательным). */
export function addWeeks(ws: string, n: number): string {
  const d = weekStartDate(ws);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/** ISO-номер недели в году (1..53). */
export function isoWeekNumber(ws: string): number {
  const d = weekStartDate(ws);
  // ISO: четверг этой недели определяет год.
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Текущий weekStart (сегодня). */
export function currentWeekStart(): string {
  return weekStart(new Date());
}

/** Сегмент по числу визитов за 30 дней: 1..6 как есть, 7+ → 7. */
export function segmentOf(visits: number): number {
  if (visits <= 0) return 0;
  return visits >= 7 ? 7 : visits;
}

/** Метка сегмента для UI: 7 → "7+". */
export function segmentLabel(seg: number | string): string {
  return String(seg) === "7" ? "7+" : String(seg);
}
