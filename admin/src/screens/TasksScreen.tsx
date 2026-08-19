import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  confirmWeek,
  downloadXlsx,
  fetchSegmentOne,
  fetchTasks,
  saveSegmentOne,
  setTaskDone,
  type SegmentOne,
  type Task,
  type TasksResponse,
} from "../services/api";

const COHORT_TITLES: Record<string, string> = {
  "5plus": "Сегмент 5+ визитов",
  "2-4": "Сегмент 2–4 визита",
  "1": "Сегмент 1 визит",
};

/** Задача менеджеру на весь сегмент (у когорты «1» задача своя, в строке). */
const COHORT_ACTIONS: Record<string, string> = {
  "5plus": "Прозвонить, узнать что случилось, прокастдевить.",
  "2-4": "Отправить СМС с предложением акции.",
  "1": "",
};

/** Порядок когорт на экране и в выгрузках. */
const COHORT_ORDER = ["5plus", "2-4", "1"] as const;

/** Способ связи под задачу сегмента: звонок или СМС. */
const COHORT_CONTACT: Record<string, "call" | "sms"> = {
  "5plus": "call",
  "2-4": "sms",
  "1": "call",
};

/** Экран «Задания»: когорты 5+ → 2–4 → 1, чекбоксы, подтверждение недели. */
export default function TasksScreen({ week }: { week: string }) {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const reload = useCallback(() => {
    fetchTasks(week).then(setData).catch(() => setData(null));
  }, [week]);

  useEffect(reload, [reload]);

  if (!data) {
    return (
      <p className="py-[32px] text-center font-sans text-[15px] text-[var(--color-muted)]">
        Загрузка…
      </p>
    );
  }

  const editable = data.isCurrentWeek && !data.confirmed;

  const toggle = async (t: Task) => {
    if (!editable) return;
    // оптимистично
    setData((d) =>
      d
        ? {
            ...d,
            cohorts: Object.fromEntries(
              Object.entries(d.cohorts).map(([k, list]) => [
                k,
                list.map((x) => (x.id === t.id ? { ...x, done: t.done ? 0 : 1 } : x)),
              ]),
            ) as TasksResponse["cohorts"],
          }
        : d,
    );
    try {
      await setTaskDone(t.id, !t.done);
      reload();
    } catch {
      reload();
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await confirmWeek(week);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const copyText = async () => {
    const lines: string[] = [];
    // Идём по явному порядку когорт, а не по Object.entries: числовой ключ «1»
    // JS перечисляет первым, из-за чего сегмент 2–4 уезжал в самый хвост
    // и терялся при вставке в мессенджер, обрезающий длинный текст.
    for (const cohort of COHORT_ORDER) {
      const list = data.cohorts[cohort];
      if (!list.length) continue;
      lines.push(`— ${COHORT_TITLES[cohort]} —`);
      if (COHORT_ACTIONS[cohort]) lines.push(COHORT_ACTIONS[cohort]);
      for (const t of list) {
        if (!t.guestName) {
          lines.push(t.reason);
          continue;
        }
        const fav = [t.favoriteDrink, t.favoriteFood].filter(Boolean).join(", ");
        lines.push(
          `${t.guestName}, ${t.guestPhone ?? "—"}${fav ? ` — любит: ${fav}` : ""}`,
        );
      }
    }
    const text = lines.join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: "Задания недели", text });
        return;
      } catch {
        /* отменили — копируем */
      }
    }
    await navigator.clipboard.writeText(text);
    alert("Скопировано в буфер");
  };

  const cohorts = COHORT_ORDER;
  const hasTasks = data.total > 0;

  // Сетка таблицы: Гость | Номер | Что случилось | Любимое из меню | галочка.
  // Телефон — фиксированная колонка, чтобы номер влезал целиком; остальные
  // тексты переносятся по словам (обрезка съедала суть — «Флэт уайт на …»).
  const GRID = "minmax(0,0.85fr) 92px minmax(0,1.1fr) minmax(0,1.1fr) 26px";

  return (
    <div className="pb-[24px]">
      {data.confirmed && (
        <div className="animate-rise mb-[12px] rounded-[16px] bg-[var(--color-accrual)]/10 px-[16px] py-[12px] font-sans text-[14px] text-black">
          ✓ Неделя подтверждена на 100%
          {data.confirmedByName ? ` — ${data.confirmedByName}` : ""}
        </div>
      )}

      {!hasTasks && (
        <p className="py-[32px] text-center font-sans text-[15px] text-[var(--color-muted)]">
          Задач на эту неделю нет
        </p>
      )}

      {cohorts.map(
        (c) =>
          data.cohorts[c].length > 0 && (
            <section key={c} className="animate-rise mt-[20px] first:mt-0">
              <h2 className="font-montserrat text-[18px] font-black tracking-[-0.3px] text-black">
                {COHORT_TITLES[c]}
              </h2>
              {COHORT_ACTIONS[c] && (
                <p className="mt-[4px] mb-[8px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
                  {COHORT_ACTIONS[c]}
                </p>
              )}
              {c === "1" ? (
                // Сегмент «1 визит» — без персон, поэтому таблица не нужна:
                // одна общая задача с галочкой.
                data.cohorts[c].map((t) => (
                  <div
                    key={t.id}
                    onClick={() => toggle(t)}
                    className={`flex items-start gap-[12px] rounded-[16px] bg-[var(--color-secondary-bg)] px-[16px] py-[14px] ${
                      editable ? "cursor-pointer" : "opacity-70"
                    }`}
                  >
                    <span
                      className={`min-w-0 flex-1 font-sans text-[14px] leading-[19px] text-black ${DIM} ${
                        t.done ? "opacity-40" : ""
                      }`}
                    >
                      {t.reason}
                      {!!t.done && t.doneByName && (
                        <span className="mt-[4px] block text-[12px] leading-[15px] text-[var(--color-accrual)]">
                          Выполнил: {t.doneByName}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(t);
                      }}
                      disabled={!editable}
                      aria-pressed={!!t.done}
                      aria-label="Выполнено"
                      className="shrink-0"
                    >
                      <Checkbox checked={!!t.done} />
                    </button>
                  </div>
                ))
              ) : (
              /* Таблицу можно листать вбок, если не влезает (как в аналитике). */
              <div className="overflow-x-auto rounded-[16px] bg-[var(--color-secondary-bg)]">
                <div className="min-w-[640px]">
                {/* Шапка таблицы */}
                <div
                  className="grid items-stretch gap-[8px] border-b border-black/[0.08] py-[9px] font-sans text-[11px] font-semibold tracking-[0.3px] text-[var(--color-muted)] uppercase"
                  style={{ gridTemplateColumns: GRID }}
                >
                  <span className={`${STICKY_CELL} ${COL_BORDER}`}>Гость</span>
                  <span className={COL_BORDER}>Номер</span>
                  <span className={COL_BORDER}>Что случилось</span>
                  <span className={COL_BORDER}>Любимое из меню</span>
                  <span className="pr-[14px]" />
                </div>

                {data.cohorts[c].map((t, i) => (
                  <div key={t.id}>
                    {i > 0 && <div className="h-px bg-black/[0.06]" />}
                    {/* Строка-грид: клик по ней переключает выполнение, но внутри
                        есть своя ссылка «Позвонить», поэтому это не <button>. */}
                    <div
                      onClick={() => toggle(t)}
                      className={`grid w-full items-stretch gap-[8px] py-[11px] text-left ${
                        editable ? "cursor-pointer" : "opacity-70"
                      }`}
                      style={{ gridTemplateColumns: GRID }}
                    >
                      {t.guestName ? (
                        <>
                          {/* Гасим текст, а не ячейку: фон sticky-колонки должен
                              остаться непрозрачным, иначе под ним будет видна
                              прокручиваемая таблица. */}
                          <span className={`${STICKY_CELL_ROW} ${COL_BORDER}`}>
                            <span
                              className={`block font-sans text-[13px] leading-[17px] font-medium break-words text-black ${DIM} ${
                                t.done ? "opacity-40" : ""
                              }`}
                            >
                              {t.guestName}
                            </span>
                            {t.cashbackCategory && (
                              <CashbackBadge
                                category={t.cashbackCategory}
                                dimmed={!!t.done}
                              />
                            )}
                          </span>
                          <span
                            className={`min-w-0 ${COL_BORDER} ${DIM} ${t.done ? "opacity-40" : ""}`}
                          >
                            <span className="block font-sans text-[12px] leading-[17px] font-medium text-black tabular-nums">
                              {t.guestPhone ?? "—"}
                            </span>
                            {t.guestPhone && (
                              <a
                                href={`${COHORT_CONTACT[c] === "sms" ? "sms" : "tel"}:${t.guestPhone.replace(/[^\d+]/g, "")}`}
                                onClick={(e) => e.stopPropagation()}
                                className="tap mt-[4px] inline-flex items-center gap-[4px] rounded-full bg-[var(--color-accent)] px-[8px] py-[3px] font-sans text-[11px] font-semibold text-white"
                              >
                                {COHORT_CONTACT[c] === "sms" ? <SmsIcon /> : <PhoneIcon />}
                                {COHORT_CONTACT[c] === "sms" ? "Написать" : "Позвонить"}
                              </a>
                            )}
                          </span>
                          {/* «Что случилось» — почему гость в задаче: просевшие
                              визиты/сумма. Даёт менеджеру повод для звонка. */}
                          <span
                            className={`min-w-0 font-sans text-[12px] leading-[16px] break-words text-black ${COL_BORDER} ${DIM} ${
                              t.done ? "opacity-40" : ""
                            }`}
                          >
                            {t.reason ? (
                              t.reason
                            ) : (
                              <span className="text-[var(--color-muted)]">—</span>
                            )}
                          </span>
                        </>
                      ) : (
                        // Общая задача (когорта «1»): текст на всю ширину.
                        <span
                          className={`col-span-4 min-w-0 pl-[14px] font-sans text-[13px] leading-[18px] text-black ${DIM} ${
                            t.done ? "opacity-40" : ""
                          }`}
                        >
                          {t.reason}
                        </span>
                      )}
                      {t.guestName && (
                        <span
                          className={`min-w-0 font-sans text-[12px] leading-[16px] break-words text-black ${COL_BORDER} ${DIM} ${
                            t.done ? "opacity-40" : ""
                          }`}
                        >
                          {t.favoriteDrink || t.favoriteFood ? (
                            <>
                              {t.favoriteDrink && (
                                <span className="block">☕ {t.favoriteDrink}</span>
                              )}
                              {t.favoriteFood && (
                                <span className="mt-[2px] block">🍽 {t.favoriteFood}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                          {!!t.done && t.doneByName && (
                            <span className="mt-[2px] block text-[11px] leading-[14px] text-[var(--color-accrual)]">
                              {t.doneByName}
                            </span>
                          )}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(t);
                        }}
                        disabled={!editable}
                        aria-pressed={!!t.done}
                        aria-label="Выполнено"
                        className="flex items-start justify-end pr-[14px]"
                      >
                        <Checkbox checked={!!t.done} />
                      </button>
                    </div>
                  </div>
                ))}
                </div>
              </div>
              )}
            </section>
          ),
      )}

      <Segment1Section week={week} editable={editable} />

      {hasTasks && (
        <>
          <div className="mt-[16px] flex gap-[10px]">
            <button
              type="button"
              onClick={copyText}
              className="tap flex-1 rounded-[16px] bg-white py-[12px] text-center font-sans text-[15px] text-black"
            >
              Поделиться
            </button>
            <button
              type="button"
              onClick={() => downloadXlsx("tasks", week)}
              className="tap flex-1 rounded-[16px] bg-white py-[12px] text-center font-sans text-[15px] text-black"
            >
              Excel
            </button>
          </div>

          {!data.confirmed && (
            <button
              type="button"
              onClick={confirm}
              disabled={!data.canConfirm || !editable || busy}
              className="tap mt-[16px] h-[56px] w-full rounded-full bg-[var(--color-accent)] font-sans text-[17px] font-semibold tracking-[-0.4px] text-white disabled:bg-[#c3c6cb] disabled:shadow-none"
            >
              Подтвердить выполнение заданий
            </button>
          )}

          {/* Вторичная кнопка: как формируются задания (правила отбора). */}
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            className="tap mt-[10px] h-[48px] w-full rounded-full border border-black/[0.10] bg-white font-sans text-[15px] font-medium text-[var(--color-muted)]"
          >
            Как формируются задания
          </button>

          <p className="mt-[8px] text-center font-sans text-[12px] text-[var(--color-muted)]">
            Выполнено {data.doneCount} из {data.total}
            {!editable && !data.confirmed && " · неделя закрыта для правок"}
          </p>
        </>
      )}

      {rulesOpen && <RulesSheet onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

/** Пункт правил: заголовок + текст. */
function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-montserrat text-[15px] font-black text-black">{title}</p>
      <div className="mt-[4px] font-sans text-[14px] leading-[20px] text-[var(--color-muted)]">
        {children}
      </div>
    </div>
  );
}

/**
 * Нижний лист «Как формируются задания» — правила отбора простыми словами,
 * чтобы менеджер понимал, откуда берётся список и почему звонить.
 */
function RulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="animate-rise absolute inset-0 z-50 flex items-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88%] w-full flex-col rounded-t-[28px] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-[28px] pt-[12px]">
          <div className="mx-auto mb-[14px] h-[5px] w-[40px] rounded-full bg-black/15" />
          <p className="font-montserrat text-[22px] font-black text-black">
            Как формируются задания
          </p>
          <p className="mt-[4px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
            Список собирается автоматически раз в неделю по продажам — вручную его
            никто не ведёт.
          </p>
        </div>

        <div className="mt-[16px] flex flex-col gap-[18px] overflow-y-auto px-[28px] pb-[28px]">
          <Rule title="Кого берём">
            Постоянных гостей, которые начали пропадать. У каждого гостя мы знаем
            его личный ритм — как часто он обычно заходит. Если он молчит заметно
            дольше обычного (в 1,5 раза и больше) — попадает в задания.
            <br />
            <span className="mt-[4px] block text-[var(--color-muted)]">
              Пример: заходил раз в 3 дня, а не был уже 10 — повод позвонить.
            </span>
          </Rule>

          <Rule title="Кого не берём">
            • Случайных гостей — если визитов мало, ритм не определить.
            <br />• Тех, кто заходил совсем недавно — они ещё в своём ритме.
          </Rule>

          <Rule title="Кто в приоритете">
            Сначала самые ценные по тратам. За неделю показываем до 80 гостей —
            остальные ждут своей очереди в следующие недели.
          </Rule>

          <Rule title="Чтобы не надоедать">
            • Позвонили гостю (отметили галочкой) — не покажем его снова 2 недели.
            <br />• Показали, но не позвонили — вернётся в список через неделю.
          </Rule>

          <Rule title="Что значит «Что случилось»">
            Это обычный ритм гостя и сколько он уже не заходил — то самое, о чём
            стоит спросить при звонке.
          </Rule>

          <Rule title="Сегменты">
            • <b className="text-black">5+</b> — частые гости (от 5 визитов в месяц).
            <br />• <b className="text-black">2–4</b> — средней частоты.
            <br />• <b className="text-black">1 визит</b> — новые гости: вручную
            ведём план/факт по блогерам и просмотрам, а список с телефонами
            выгружаем для SMS.
          </Rule>

          <button
            type="button"
            onClick={onClose}
            className="tap mt-[2px] h-[52px] w-full rounded-full bg-[var(--color-secondary-bg)] font-sans text-[16px] font-medium text-black"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}

/** Бейдж категории лояльности гостя; «VIP … 15%» выделяем акцентом. */
function CashbackBadge({
  category,
  dimmed,
}: {
  category: string;
  dimmed?: boolean;
}) {
  const isVip = /15\s*%/.test(category);
  return (
    <span
      className={`mt-[3px] inline-block rounded-full px-[7px] py-[1px] font-sans text-[10px] font-semibold ${DIM} ${
        dimmed ? "opacity-40" : ""
      } ${
        isVip
          ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          : "bg-black/[0.06] text-[var(--color-muted)]"
      }`}
    >
      {category}
    </span>
  );
}

/** Поле ввода целого числа ≥ 0 для формы сегмента «1 визит». */
function NumField({
  label,
  value,
  onChange,
  editable,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  editable: boolean;
}) {
  return (
    <label className="block">
      <span className="block font-sans text-[12px] text-[var(--color-muted)]">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        disabled={!editable}
        onChange={(e) =>
          onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))
        }
        className="mt-[4px] w-full rounded-[12px] border border-black/[0.10] bg-white px-[12px] py-[9px] font-sans text-[15px] tabular-nums text-black disabled:opacity-60"
      />
    </label>
  );
}

/**
 * Сегмент «1 визит»: ручной ввод блогеров и просмотров (план/факт) за неделю +
 * выгрузка новых гостей с телефонами для SMS. Заменяет прежнюю авто-задачу.
 */
function Segment1Section({
  week,
  editable,
}: {
  week: string;
  editable: boolean;
}) {
  const [data, setData] = useState<SegmentOne | null>(null);
  const [form, setForm] = useState({
    bloggersPlan: 0,
    bloggersFact: 0,
    viewsPlan: 0,
    viewsFact: 0,
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchSegmentOne(week)
      .then((r) => {
        setData(r);
        setForm({
          bloggersPlan: r.bloggersPlan,
          bloggersFact: r.bloggersFact,
          viewsPlan: r.viewsPlan,
          viewsFact: r.viewsFact,
        });
        setDirty(false);
      })
      .catch(() => setData(null));
  }, [week]);

  if (!data) return null;

  const set = (k: keyof typeof form) => (v: number) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveSegmentOne(week, form);
      setDirty(false);
      const r = await fetchSegmentOne(week);
      setData(r);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="animate-rise mt-[20px]">
      <h2 className="font-montserrat text-[18px] font-black tracking-[-0.3px] text-black">
        Сегмент 1 визит
      </h2>
      <p className="mt-[4px] mb-[8px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
        Новые гости приходят через блогеров и SMM. Внесите план и факт за неделю.
      </p>

      <div className="rounded-[16px] bg-[var(--color-secondary-bg)] p-[16px]">
        <div className="grid grid-cols-2 gap-[14px]">
          <NumField
            label="Блогеры, план"
            value={form.bloggersPlan}
            onChange={set("bloggersPlan")}
            editable={editable}
          />
          <NumField
            label="Блогеры, факт"
            value={form.bloggersFact}
            onChange={set("bloggersFact")}
            editable={editable}
          />
          <NumField
            label="Просмотры, план"
            value={form.viewsPlan}
            onChange={set("viewsPlan")}
            editable={editable}
          />
          <NumField
            label="Просмотры, факт"
            value={form.viewsFact}
            onChange={set("viewsFact")}
            editable={editable}
          />
        </div>

        {editable && (
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="tap mt-[14px] h-[46px] w-full rounded-full bg-[var(--color-accent)] font-sans text-[15px] font-semibold text-white disabled:bg-[#c3c6cb]"
          >
            {saving ? "Сохраняю…" : dirty ? "Сохранить" : "Сохранено ✓"}
          </button>
        )}

        {data.updatedByName && (
          <p className="mt-[8px] font-sans text-[12px] text-[var(--color-muted)]">
            Обновил: {data.updatedByName}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => downloadXlsx("leads", week)}
        className="tap mt-[10px] w-full rounded-[16px] bg-white py-[12px] text-center font-sans text-[15px] text-black"
      >
        Скачать 1-визитных для SMS (Excel)
      </button>
    </section>
  );
}

/**
 * Колонка «Гость» закреплена слева: при листании таблицы вбок имя не уезжает.
 * Фон непрозрачный, иначе под ней просвечивают колонки, уходящие под неё.
 */
const STICKY_CELL =
  "sticky left-0 z-10 min-w-0 bg-[var(--color-secondary-bg)] pl-[14px] pr-[4px]";

/**
 * То же для строк: дополнительно перекрываем вертикальный padding строки,
 * иначе в него затекает тень кнопки «Позвонить» из уехавшей колонки.
 */
const STICKY_CELL_ROW = `${STICKY_CELL} -my-[11px] py-[11px]`;

/** Плавное гашение содержимого выполненной задачи. */
const DIM = "transition-opacity duration-200";

/** Вертикальная грань между колонками таблицы. */
const COL_BORDER = "border-r border-black/[0.07]";

/** Трубка для кнопки быстрого набора. */
function PhoneIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M3.2 1.5 4.4 4 3.4 4.9c.5 1.2 1.5 2.2 2.7 2.7l.9-1 2.5 1.2v1.9c0 .4-.3.8-.8.8C4.6 10.5 1.5 7.4 1.5 2.3c0-.4.3-.8.8-.8h.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Конверт для кнопки отправки СМС. */
function SmsIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M1.5 2.5h9v6.2a.8.8 0 0 1-.8.8H2.3a.8.8 0 0 1-.8-.8V2.5Zm.9.8L6 6.1l3.6-2.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex size-[24px] shrink-0 items-center justify-center rounded-[8px] border-2 transition-colors ${
        checked
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
          : "border-[#c3c6cb] bg-white"
      }`}
      aria-hidden
    >
      {checked && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 7.5 5.7 10 11 4.5"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
