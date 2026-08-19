const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** Понедельник недели (weekStart = YYYY-MM-DD) → Date в UTC. */
function toDate(weekStart: string): Date {
  return new Date(weekStart + "T00:00:00Z");
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** «20–26 июля», а на стыке месяцев — «29 июня – 5 июля». */
export function weekRange(weekStart: string): string {
  const from = toDate(weekStart);
  const to = addDays(from, 6);
  const d1 = from.getUTCDate();
  const d2 = to.getUTCDate();
  const m1 = MONTHS[from.getUTCMonth()];
  const m2 = MONTHS[to.getUTCMonth()];
  return m1 === m2 ? `${d1}–${d2} ${m2}` : `${d1} ${m1} – ${d2} ${m2}`;
}

/** Предыдущая неделя в том же формате. */
export function prevWeekRange(weekStart: string): string {
  return weekRange(addDays(toDate(weekStart), -7).toISOString().slice(0, 10));
}

/**
 * Бейдж под селектором недели: какие именно даты выбраны и что с чем
 * сравнивается. Формулировка разная по экранам — в аналитике смотрим данные
 * ЗА неделю, а задания сформированы по просадке ОТНОСИТЕЛЬНО прошлой.
 */
export default function WeekBadge({
  week,
  tab,
  isCurrentWeek = false,
}: {
  week: string;
  tab: "tasks" | "analytics";
  /** Текущая неделя не закрыта — по ней аналитики ещё нет. */
  isCurrentWeek?: boolean;
}) {
  if (!week) return null;
  // Аналитика по идущей неделе не считается, поэтому и подпись другая.
  const pending = tab === "analytics" && isCurrentWeek;
  return (
    <div className="mb-[10px] flex flex-wrap items-center justify-center gap-x-[6px] gap-y-[2px] text-center">
      <span className="rounded-full bg-[var(--color-accent)]/10 px-[10px] py-[3px] font-sans text-[12px] font-semibold text-[var(--color-accent)]">
        {tab === "tasks" ? "Задания на " : "Аналитика за "}
        {weekRange(week)}
      </span>
      <span className="font-sans text-[11px] text-[var(--color-muted)]">
        {pending
          ? "неделя ещё идёт"
          : `${tab === "tasks" ? "на данных " : "сравнение с "}${prevWeekRange(week)}`}
      </span>
    </div>
  );
}
