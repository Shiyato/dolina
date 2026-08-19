import { useEffect, useMemo, useState } from "react";
import {
  fetchOlapColumns,
  fetchOlapStatus,
  runOlapReport,
  type OlapColumn,
  type OlapReport,
  type ReportType,
} from "../services/api";

/** YYYY-MM-DD n дней назад от сегодня. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Экран «Отчёты» — OLAP из iikoServer. Конструктор: тип отчёта, период,
 * поля группировки и агрегации (подгружаются из живого списка полей), таблица
 * результата. Пресеты пред-заполняют частые связки («по блюдам», «кто что
 * купил»). Пока не настроены доступы iikoServer — показываем инструкцию.
 */
export default function ReportsScreen() {
  const [status, setStatus] = useState<"loading" | "off" | "on">("loading");

  useEffect(() => {
    fetchOlapStatus()
      .then((r) => setStatus(r.configured ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, []);

  if (status === "loading") return <Center>Загрузка…</Center>;
  if (status === "off") return <NotConfigured />;
  return <ReportBuilder />;
}

function ReportBuilder() {
  const [reportType, setReportType] = useState<ReportType>("SALES");
  const [columns, setColumns] = useState<OlapColumn[] | null>(null);
  const [colsErr, setColsErr] = useState<string | null>(null);
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(daysAgo(0));
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [agg, setAgg] = useState<string[]>([]);
  const [report, setReport] = useState<OlapReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);

  // Поля для выбранного типа отчёта.
  useEffect(() => {
    setColumns(null);
    setColsErr(null);
    setGroupBy([]);
    setAgg([]);
    setReport(null);
    fetchOlapColumns(reportType)
      .then((r) => setColumns(r.columns))
      .catch((e) => setColsErr(e?.message ?? "Ошибка загрузки полей"));
  }, [reportType]);

  const groupCols = useMemo(
    () => (columns ?? []).filter((c) => c.groupingAllowed),
    [columns],
  );
  const aggCols = useMemo(
    () => (columns ?? []).filter((c) => c.aggregationAllowed),
    [columns],
  );

  /** Найти поле по FieldName или по вхождению в человекочитаемое имя. */
  const find = (pred: (c: OlapColumn) => boolean) =>
    (columns ?? []).find(pred)?.field;

  const applyPreset = (preset: "byDish" | "byGuest") => {
    const dish =
      find((c) => c.field === "DishName") ??
      find((c) => c.groupingAllowed && /блюд/i.test(c.name)) ??
      find((c) => c.field.startsWith("Product"));
    const amount =
      find((c) => c.field === "DishAmountInt") ??
      find((c) => c.aggregationAllowed && /кол-во|количество/i.test(c.name));
    const sum =
      find((c) => c.field === "DishSumInt") ??
      find((c) => c.aggregationAllowed && /сумма/i.test(c.name));
    const guest =
      find((c) => c.groupingAllowed && /гост|карт|клиент/i.test(c.name)) ??
      find((c) => /guest|customer/i.test(c.field));

    const g: string[] = [];
    if (preset === "byGuest" && guest) g.push(guest);
    if (dish) g.push(dish);
    const a = [amount, sum].filter(Boolean) as string[];
    setGroupBy(g);
    setAgg(a);
  };

  const toggle = (arr: string[], set: (v: string[]) => void, field: string) =>
    set(arr.includes(field) ? arr.filter((x) => x !== field) : [...arr, field]);

  const run = async () => {
    setLoading(true);
    setRunErr(null);
    setReport(null);
    try {
      const r = await runOlapReport({
        reportType,
        groupByRowFields: groupBy,
        aggregateFields: agg,
        from,
        to,
      });
      setReport(r);
    } catch (e) {
      setRunErr((e as { message?: string })?.message ?? "Ошибка отчёта");
    } finally {
      setLoading(false);
    }
  };

  const nameOf = (field: string) =>
    (columns ?? []).find((c) => c.field === field)?.name ?? field;

  return (
    <div className="pb-[24px]">
      <h1 className="font-montserrat text-[22px] font-black tracking-[-0.4px] text-black">
        Отчёты
      </h1>
      <p className="mt-[2px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
        Данные из iiko (OLAP). Выберите период и поля — или готовый пресет.
      </p>

      {/* Тип отчёта */}
      <div className="mt-[14px] flex gap-[8px]">
        {(["SALES", "TRANSACTIONS", "DELIVERIES"] as ReportType[]).map((rt) => (
          <button
            key={rt}
            type="button"
            onClick={() => setReportType(rt)}
            className={`rounded-full px-[14px] py-[7px] font-sans text-[13px] font-semibold ${
              reportType === rt
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-secondary-bg)] text-[var(--color-muted)]"
            }`}
          >
            {rt === "SALES" ? "Продажи" : rt === "TRANSACTIONS" ? "Проводки" : "Доставки"}
          </button>
        ))}
      </div>

      {/* Период */}
      <div className="mt-[12px] flex items-end gap-[10px]">
        <DateField label="С" value={from} onChange={setFrom} />
        <DateField label="По" value={to} onChange={setTo} />
      </div>

      {colsErr && <ErrorBox>{colsErr}</ErrorBox>}

      {!columns && !colsErr && (
        <p className="mt-[16px] font-sans text-[14px] text-[var(--color-muted)]">
          Загрузка полей…
        </p>
      )}

      {columns && (
        <>
          {/* Пресеты */}
          <div className="mt-[16px] flex flex-wrap gap-[8px]">
            <PresetChip onClick={() => applyPreset("byDish")}>Продажи по блюдам</PresetChip>
            <PresetChip onClick={() => applyPreset("byGuest")}>Кто что купил</PresetChip>
          </div>

          {/* Группировка */}
          <FieldPicker
            title="Группировка (строки)"
            cols={groupCols}
            selected={groupBy}
            onToggle={(f) => toggle(groupBy, setGroupBy, f)}
          />
          {/* Агрегация */}
          <FieldPicker
            title="Показатели"
            cols={aggCols}
            selected={agg}
            onToggle={(f) => toggle(agg, setAgg, f)}
          />

          <button
            type="button"
            onClick={run}
            disabled={loading || !groupBy.length || !agg.length}
            className="tap mt-[16px] h-[50px] w-full rounded-full bg-[var(--color-accent)] font-sans text-[16px] font-semibold text-white disabled:bg-[#c3c6cb]"
          >
            {loading ? "Загружаю…" : "Построить отчёт"}
          </button>

          {runErr && <ErrorBox>{runErr}</ErrorBox>}

          {report?.favorites?.applicable && (
            <div className="mt-[12px] rounded-[12px] bg-[var(--color-accrual)]/10 px-[14px] py-[10px] font-sans text-[13px] leading-[18px] text-black">
              ✓ Любимое обновлено: {report.favorites.matchedGuests} гостей,{" "}
              {report.favorites.ingested} позиций
              {report.favorites.unmatched > 0 && (
                <span className="text-[var(--color-muted)]">
                  {" "}
                  · не сопоставлено строк: {report.favorites.unmatched}
                </span>
              )}
            </div>
          )}

          {report && <ReportTable report={report} nameOf={nameOf} />}
        </>
      )}
    </div>
  );
}

function ReportTable({
  report,
  nameOf,
}: {
  report: OlapReport;
  nameOf: (f: string) => string;
}) {
  if (!report.rows.length) {
    return (
      <p className="mt-[16px] text-center font-sans text-[14px] text-[var(--color-muted)]">
        Нет данных за выбранный период.
      </p>
    );
  }
  return (
    <div className="mt-[16px]">
      <p className="mb-[6px] font-sans text-[12px] text-[var(--color-muted)]">
        Строк: {report.rows.length}
      </p>
      <div className="overflow-x-auto rounded-[14px] bg-[var(--color-secondary-bg)]">
        <table className="w-full min-w-[420px] border-collapse font-sans text-[13px]">
          <thead>
            <tr className="text-left text-[var(--color-muted)]">
              {report.columns.map((c) => (
                <th key={c} className="px-[12px] py-[9px] font-medium whitespace-nowrap">
                  {nameOf(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, i) => (
              <tr key={i} className="border-t border-black/[0.05]">
                {report.columns.map((c) => (
                  <td key={c} className="px-[12px] py-[8px] whitespace-nowrap text-black">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ru-RU");
  return String(v);
}

function FieldPicker({
  title,
  cols,
  selected,
  onToggle,
}: {
  title: string;
  cols: OlapColumn[];
  selected: string[];
  onToggle: (field: string) => void;
}) {
  return (
    <div className="mt-[16px]">
      <p className="font-montserrat text-[14px] font-black text-black">{title}</p>
      <div className="mt-[8px] flex flex-wrap gap-[6px]">
        {cols.map((c) => {
          const on = selected.includes(c.field);
          return (
            <button
              key={c.field}
              type="button"
              onClick={() => onToggle(c.field)}
              title={c.field}
              className={`rounded-full px-[11px] py-[6px] font-sans text-[12px] ${
                on
                  ? "bg-black text-white"
                  : "bg-[var(--color-secondary-bg)] text-[var(--color-muted)]"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex-1">
      <span className="block font-sans text-[12px] text-[var(--color-muted)]">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-[4px] w-full rounded-[12px] border border-black/[0.10] bg-white px-[12px] py-[9px] font-sans text-[15px] text-black"
      />
    </label>
  );
}

function PresetChip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/8 px-[14px] py-[7px] font-sans text-[13px] font-semibold text-[var(--color-accent)]"
    >
      {children}
    </button>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[12px] rounded-[12px] bg-[var(--color-danger)]/10 px-[14px] py-[10px] font-sans text-[13px] leading-[18px] text-[var(--color-danger)]">
      {children}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-[32px] text-center font-sans text-[15px] text-[var(--color-muted)]">
      {children}
    </p>
  );
}

/** Заглушка, пока доступы к iikoServer не заданы в env. */
function NotConfigured() {
  return (
    <div className="pb-[24px]">
      <h1 className="font-montserrat text-[22px] font-black tracking-[-0.4px] text-black">
        Отчёты
      </h1>
      <div className="mt-[14px] rounded-[16px] bg-[#fff3e0] px-[16px] py-[14px]">
        <p className="font-montserrat text-[15px] font-black text-black">
          Подключение к iiko не настроено
        </p>
        <p className="mt-[6px] font-sans text-[14px] leading-[20px] text-black">
          OLAP-отчёты берутся из сервера iiko (iikoOffice/iikoServer). Чтобы
          включить, добавьте в настройки сервера доступ отдельного пользователя
          офиса с правом на отчёты:
        </p>
        <ul className="mt-[8px] list-disc pl-[20px] font-sans text-[13px] leading-[20px] text-[var(--color-muted)]">
          <li>адрес сервера iiko (host:port);</li>
          <li>логин пользователя офиса (только право «Отчёты OLAP»);</li>
          <li>его пароль.</li>
        </ul>
        <p className="mt-[8px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
          Доступы хранятся только на сервере. Как заданы — страница сразу
          заработает.
        </p>
      </div>
    </div>
  );
}
