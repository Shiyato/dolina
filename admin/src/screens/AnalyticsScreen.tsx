import { useEffect, useState } from "react";
import {
  downloadXlsx,
  fetchAnalytics,
  type AnalyticsResponse,
  type ChartPoint,
} from "../services/api";

/** Экран «Аналитика»: таблица сегментов + графики по 6 недель. */
export default function AnalyticsScreen({
  week,
  isCurrentWeek = false,
}: {
  week: string;
  /** Текущая неделя ещё идёт — её цифры неполные, аналитику не показываем. */
  isCurrentWeek?: boolean;
}) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);

  useEffect(() => {
    setData(null);
    fetchAnalytics(week).then(setData).catch(() => setData(null));
  }, [week]);

  if (!data) {
    return (
      <p className="py-[32px] text-center font-sans text-[15px] text-[var(--color-muted)]">
        Загрузка…
      </p>
    );
  }

  const total = data.segments.find((s) => s.segment === "total");

  return (
    <div className="pb-[24px]">
      {isCurrentWeek && (
        <div className="animate-rise mb-[12px] flex items-center gap-[8px] rounded-[16px] bg-[#fff3e0] px-[16px] py-[11px]">
          <span className="inline-block size-[8px] shrink-0 rounded-full bg-[#f5a623]" />
          <p className="font-sans text-[13px] leading-[17px] text-black">
            <b>Неделя не закрыта</b> — данные за неполный период, без сравнения с
            прошлой неделей.
          </p>
        </div>
      )}

      {/* Таблица сегментов */}
      <section className="animate-rise">
        <h2 className="font-montserrat text-[18px] font-black tracking-[-0.3px] text-black">
          Сегменты за неделю
        </h2>
        <div className="mt-[8px] overflow-x-auto rounded-[16px] bg-[var(--color-secondary-bg)]">
          {isCurrentWeek ? (
            // Неделя идёт: абсолютные цифры без «было/Δ» (сравнивать не с чем).
            <table className="w-full min-w-[360px] border-collapse font-sans text-[13px]">
              <thead>
                <tr className="text-left text-[var(--color-muted)]">
                  <Th>Сегмент</Th>
                  <Th r>Гости</Th>
                  <Th r>Чеки</Th>
                  <Th r>Выручка, ₽</Th>
                </tr>
              </thead>
              <tbody>
                {data.segments.map((s) => (
                  <tr
                    key={s.segment}
                    className={`border-t border-black/[0.05] ${
                      s.segment === "total" ? "font-semibold" : ""
                    }`}
                  >
                    <Td>{s.segment === "total" ? "Итого" : s.segment}</Td>
                    <Td r>{s.curGuests}</Td>
                    <Td r>{s.curChecks}</Td>
                    <Td r>{money(s.curSum)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[720px] border-collapse font-sans text-[13px]">
              <thead>
                <tr className="text-left text-[var(--color-muted)]">
                  <Th>Сегмент</Th>
                  <Th r>Гости, было</Th>
                  <Th r>Гости, стало</Th>
                  <Th r>Δ гостей</Th>
                  <Th r>Чеки, было</Th>
                  <Th r>Чеки, стало</Th>
                  <Th r>Δ чеков</Th>
                  <Th r>Выручка, стало</Th>
                  <Th r>Δ выручки</Th>
                </tr>
              </thead>
              <tbody>
                {data.segments.map((s) => (
                  <tr
                    key={s.segment}
                    className={`border-t border-black/[0.05] ${
                      s.segment === "total" ? "font-semibold" : ""
                    }`}
                  >
                    <Td>{s.segment === "total" ? "Итого" : s.segment}</Td>
                    <Td r muted>{s.prevGuests}</Td>
                    <Td r>{s.curGuests}</Td>
                    <Td r>
                      <Delta value={s.dGuests} pct={s.dGuestsPct} />
                    </Td>
                    <Td r muted>{s.prevChecks}</Td>
                    <Td r>{s.curChecks}</Td>
                    <Td r>
                      <Delta value={s.dChecks} pct={s.dChecksPct} />
                    </Td>
                    <Td r>{money(s.curSum)}</Td>
                    <Td r>
                      <Delta value={s.dSum} pct={s.dSumPct} money />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!isCurrentWeek && total && (
          <p className="mt-[8px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
            Главное: по гостям{" "}
            <b className={total.dGuestsPct < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-accrual)]"}>
              {total.dGuestsPct > 0 ? "+" : ""}
              {total.dGuestsPct}%
            </b>
            , по чекам{" "}
            <b className={total.dChecksPct < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-accrual)]"}>
              {total.dChecksPct > 0 ? "+" : ""}
              {total.dChecksPct}%
            </b>
            , по выручке{" "}
            <b className={total.dSumPct < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-accrual)]"}>
              {total.dSumPct > 0 ? "+" : ""}
              {total.dSumPct}%
            </b>{" "}
            к прошлой неделе.
          </p>
        )}
      </section>

      {/* Графики: на сегмент — 3 мини-чарта (гости/чеки/ср.чек) × 6 недель */}
      <section className="animate-rise stagger-1 mt-[20px]">
        <h2 className="font-montserrat text-[18px] font-black tracking-[-0.3px] text-black">
          Динамика по сегментам
        </h2>
        <div className="mt-[8px] flex flex-col gap-[12px]">
          {data.charts.map((c) => (
            <div key={c.segment} className="rounded-[16px] bg-[var(--color-secondary-bg)] p-[14px]">
              <p className="font-montserrat text-[15px] font-black text-black">
                Сегмент {c.segment}
              </p>
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <MiniBars title="Гости" series={c.series} pick={(p) => p.guests} />
                <MiniBars title="Чеки" series={c.series} pick={(p) => p.checks} />
                <MiniBars title="Выручка, ₽" series={c.series} pick={(p) => p.revenue} money />
                <MiniBars title="Ср. чек, ₽" series={c.series} pick={(p) => p.avg} money />
              </div>
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => downloadXlsx("analytics", week)}
        className="tap mt-[16px] w-full rounded-[16px] bg-white py-[12px] text-center font-sans text-[15px] text-black"
      >
        Выгрузить в Excel
      </button>
    </div>
  );
}

/** Деньги: разделитель тысяч по-русски. */
const money = (n: number) => n.toLocaleString("ru-RU");

/** Мини-бар-чарт: 6 столбцов, последний (текущая неделя) — синий, прочие серые. */
function MiniBars({
  title,
  series,
  pick,
  money: isMoney,
}: {
  title: string;
  series: ChartPoint[];
  pick: (p: ChartPoint) => number;
  money?: boolean;
}) {
  const values = series.map(pick);
  const max = Math.max(...values, 1);
  const last = values[values.length - 1] ?? 0;
  return (
    <div>
      <p className="font-sans text-[11px] text-[var(--color-muted)]">{title}</p>
      <p className="font-montserrat text-[16px] font-black text-black">
        {isMoney ? money(last) : last}
      </p>
      <div className="mt-[6px] flex h-[44px] items-end gap-[3px]">
        {values.map((v, i) => {
          const hPct = Math.max((v / max) * 100, v > 0 ? 8 : 3);
          const isCurrent = i === values.length - 1;
          return (
            <div
              key={series[i].weekStart}
              title={`Нед. ${series[i].weekNumber}: ${v}`}
              className={`flex-1 rounded-t-[3px] ${
                isCurrent ? "bg-[var(--color-accent)]" : "bg-[#c9ccd1]"
              }`}
              style={{ height: `${hPct}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

function Delta({ value, pct, money: isMoney }: { value: number; pct: number; money?: boolean }) {
  const cls =
    value < 0
      ? "text-[var(--color-danger)]"
      : value > 0
        ? "text-[var(--color-accrual)]"
        : "text-[var(--color-muted)]";
  return (
    <span className={cls}>
      {value > 0 ? "+" : ""}
      {isMoney ? money(value) : value} ({pct > 0 ? "+" : ""}
      {pct}%)
    </span>
  );
}

/** Вертикальная грань между колонками (последняя колонка — без неё). */
const COL_BORDER = "border-r border-black/[0.07] last:border-r-0";

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return (
    <th
      className={`px-[12px] py-[10px] font-medium ${COL_BORDER} ${r ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  r,
  muted,
}: {
  children: React.ReactNode;
  r?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-[12px] py-[9px] ${COL_BORDER} ${r ? "text-right" : ""} ${
        muted ? "text-[var(--color-muted)]" : "text-black"
      }`}
    >
      {children}
    </td>
  );
}
