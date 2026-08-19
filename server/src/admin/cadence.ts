import { segmentOf, weekStartDate } from "./weeks.js";

/**
 * Чистая логика выявления гостей «под риском» по их личному ритму визитов.
 * Никаких обращений к БД — так её можно гонять и в проде (generateTasks),
 * и в офлайн-диагностике на копии данных, гарантированно одним и тем же кодом.
 *
 * Идея: сравнивать не «эта неделя vs прошлая» (у нерегулярного гостя 3→2 — это
 * шум, регрессия к среднему, а не отток), а насколько долго гость молчит
 * относительно СВОЕГО обычного интервала между визитами. Затих дольше обычного
 * → повод для LTV-звонка.
 */
export const CADENCE = {
  lookbackDays: 90, // окно истории для оценки личного ритма
  minVisits: 4, // меньше визитов в окне — ритм не оценить (это когорта «1»)
  riskMultiplier: 1.5, // молчит дольше 1.5× личного интервала → под риском
  minSilenceDays: 4, // пол: ежедневного гостя не дёргаем из-за пары дней
  // Кулдаун по ВЗАИМОДЕЙСТВИЮ (а не по «дожатым» галочкам): чтобы не звонить
  // одному гостю каждую неделю и ровно распределять поток по неделям.
  contactedCooldownWeeks: 2, // позвонили (задача done=1) — пауза 2 недели
  listedCooldownWeeks: 1, // показали, но не позвонили — пауза 1 неделя
  maxTasks: 80, // ёмкость обзвона: топ-N самых ценных из группы риска
} as const;

export interface Candidate {
  guestIikoId: string;
  cohort: "5plus" | "2-4";
  medianGap: number; // обычный интервал между визитами, дней
  daysSince: number; // сколько молчит на отсечку, дней
  spend: number; // траты за окно (прокси ценности)
}

/** Медиана непустого массива. */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Разница в днях между двумя YYYY-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000,
  );
}

/**
 * Границы расчёта для недели задач: отсечка = конец последней закрытой недели
 * (день до weekStart), окно — lookbackDays назад от неё.
 */
export function windowBounds(weekStart: string): { asOf: string; from: string } {
  const asOfDate = weekStartDate(weekStart);
  asOfDate.setUTCDate(asOfDate.getUTCDate() - 1);
  const asOf = asOfDate.toISOString().slice(0, 10);
  const fromDate = new Date(asOfDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - (CADENCE.lookbackDays - 1));
  return { asOf, from: fromDate.toISOString().slice(0, 10) };
}

/**
 * «Что случилось» простыми словами — чтобы менеджер сразу понял причину звонка.
 * Для ежедневных гостей «раз в 1 дн.» звучит коряво — говорим по-человечески.
 */
export function riskReason(medianGap: number, daysSince: number): string {
  const gap = Math.round(medianGap);
  const base =
    gap <= 1 ? "Заходил почти каждый день" : `Обычно заходит раз в ${gap} дн.`;
  return `${base}, не был уже ${daysSince} дн.`;
}

/**
 * Из карты «гость → даты визитов» (по возрастанию) и карты трат отбирает
 * кандидатов «под риском» на отсечку `asOf`, отсортированных по ценности.
 * Кулдаун и лимит численности здесь НЕ применяются — это дело вызывающего.
 */
export function findCandidates(
  visitDates: Map<string, string[]>,
  spend: Map<string, number>,
  asOf: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [guestIikoId, dates] of visitDates) {
    if (dates.length < CADENCE.minVisits) continue; // ритм не оценить → когорта «1»

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const medianGap = median(gaps);
    if (medianGap <= 0) continue;

    const daysSince = daysBetween(dates[dates.length - 1], asOf);
    const threshold = Math.max(CADENCE.minSilenceDays, medianGap * CADENCE.riskMultiplier);
    if (daysSince < threshold) continue; // ходит в своём ритме — не трогаем

    // Когорту берём по ОБЫЧНОЙ частоте (≈30/интервал), а не по просевшему
    // счётчику визитов: затихший завсегдатай должен остаться в «5+», а не
    // утечь в мелкий сегмент из-за самого факта тишины.
    const seg = segmentOf(Math.round(30 / medianGap));
    const cohort = seg >= 5 ? "5plus" : seg >= 2 ? "2-4" : null;
    if (!cohort) continue; // редкие гости — общая задача когорты «1»

    candidates.push({
      guestIikoId,
      cohort,
      medianGap,
      daysSince,
      spend: spend.get(guestIikoId) ?? 0,
    });
  }
  // Приоритет — самые ценные: ограниченную ёмкость обзвона тратим на них.
  candidates.sort((a, b) => b.spend - a.spend);
  return candidates;
}
