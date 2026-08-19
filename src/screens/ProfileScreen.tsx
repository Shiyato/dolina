import { useEffect, useState } from "react";
import logoWordmark from "../assets/logo-wordmark.svg";
import StatusAvatar from "../components/StatusAvatar";
import type { Customer, Transaction } from "../services/types";
import { getTransactions } from "../services/iiko";
import {
  CONTENDER_THRESHOLD,
  loyaltyStatus,
  statusLabel,
  untilLabel,
  PRO_CASHBACK,
  PRO_CHAT_URL,
} from "../services/loyalty";

const fmt = (n: number) => n.toLocaleString("ru-RU").replace(/ /g, " ");

/** "2026-07-16T..." → "16 июля 2026". */
const dayMonth = (iso: string) =>
  new Date(iso)
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .replace(" г.", "");

/** Склонение слова «бонус» по числу. */
function bonusWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "бонус";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "бонуса";
  return "бонусов";
}

/**
 * Профиль — статус лояльности (СТАНДАРТ / ПРЕТЕНДЕНТ / ВИП) + история начислений/списаний.
 * Соответствует макету Figma (два состояния статуса).
 */
export default function ProfileScreen({
  customer,
  onBack,
  onLogout,
}: {
  customer: Customer;
  onBack: () => void;
  onLogout: () => void;
}) {
  // DEV-превью состояний выбирается в App — сюда приходит уже нужный гость,
  // тот же самый, что и на карте.
  const shown = customer;

  const [txns, setTxns] = useState<Transaction[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const bonus = shown.walletBalances.find((w) => w.type === 1)?.balance ?? 0;
  const purchases = shown.purchasesThisMonth ?? 0;
  const status = loyaltyStatus(shown);
  const isPro = status === "pro";
  const isContender = status === "contender";
  const until = untilLabel(shown.contenderUntil);

  useEffect(() => {
    let alive = true;
    getTransactions(shown.id, 0).then((r) => {
      if (!alive) return;
      setTxns(r.items);
      setHasMore(r.hasMore);
      setPage(0);
    });
    return () => {
      alive = false;
    };
  }, [shown.id]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await getTransactions(shown.id, next);
      setTxns((prev) => [...(prev ?? []), ...r.items]);
      setHasMore(r.hasMore);
      setPage(next);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-white">
      {/* Шапка: Назад + логотип */}
      <header className="animate-rise stagger-1 flex shrink-0 items-center justify-between px-[24px] pt-[20px] pb-[4px]">
        <button
          type="button"
          onClick={onBack}
          className="tap rounded-full bg-black px-[18px] py-[9px] font-sans text-[15px] font-semibold tracking-[-0.2px] text-white"
        >
          Назад
        </button>
        <img src={logoWordmark} alt="Долина кофе" className="h-[30px] w-[86px]" />
      </header>

      {/* Прокручиваемая область */}
      <div className="flex-1 overflow-y-auto px-[24px] pb-[32px]">
        {/* Аватар + статус */}
        <div className="mt-[8px] flex flex-col items-center">
          <StatusAvatar
            src={shown.avatarUrl}
            name={shown.name}
            status={status}
            size={200}
            ringWidth={5}
            className="animate-pop stagger-2"
          />
          <p
            className={`animate-rise stagger-3 mt-[10px] font-montserrat font-black tracking-[-0.6px] ${
              isContender ? "text-[26px]" : "text-[36px]"
            } ${
              isPro
                ? "text-[var(--color-pro)]"
                : isContender
                  ? "text-[var(--color-contender)]"
                  : "text-[var(--color-standard-label)]"
            }`}
          >
            {statusLabel(status)}
            {isContender && (
              <span className="block text-center text-[15px] leading-[18px] font-black tracking-[-0.2px]">
                НА ВИП
              </span>
            )}
          </p>
        </div>

        {/* Карточка: бонусы / визиты. Счётчик — просто число визитов. */}
        <div
          className={`animate-rise stagger-4 mt-[18px] flex items-center rounded-[20px] px-[24px] py-[18px] ${
            isPro
              ? "bg-[var(--color-pro)]"
              : isContender
                ? "bg-[var(--color-contender-card)]"
                : "bg-[var(--color-standard-card)]"
          }`}
        >
          <Stat value={fmt(bonus)} label={bonusWord(bonus)} />
          <div className="h-[40px] w-px bg-black/10" />
          <Stat value={`${purchases}`} label="визитов" />
        </div>

        {/* Что означает текущий статус */}
        <p className="animate-rise stagger-5 mt-[10px] text-center font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
          {isPro ? (
            <>визитов за последние 30 дней — у вас статус ВИП и {PRO_CASHBACK}% кэшбека</>
          ) : isContender ? (
            <>
              визитов за последние 30 дней. Вы{" "}
              <span className="font-semibold text-black">претендент на ВИП</span>
              {until ? <> — статус действует до {until}</> : null}
            </>
          ) : (
            <>
              визитов за последние 30 дней.
              <br />
              {CONTENDER_THRESHOLD} визитов за 30 дней — и вы станете{" "}
              <span className="font-semibold text-black">претендентом на ВИП</span>
            </>
          )}
        </p>

        {/* Претендент: что сделать, чтобы получить ВИП */}
        {isContender && (
          <div className="animate-rise stagger-5 mt-[14px] rounded-[16px] bg-[var(--color-secondary-bg)] px-[16px] py-[14px]">
            <p className="font-montserrat text-[15px] font-black tracking-[-0.2px] text-black">
              Как получить ВИП
            </p>
            <p className="mt-[6px] font-sans text-[14px] leading-[19px] text-[var(--color-muted)]">
              Загляните в кофейню — статус ВИП с {PRO_CASHBACK}% кэшбека подключат
              на кассе. ВИП остаётся навсегда.
            </p>
          </div>
        )}

        {/* ВИП: закрытый чат гостей */}
        {isPro && (
          <a
            href={PRO_CHAT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="tap animate-rise stagger-5 mt-[14px] flex items-center gap-[12px] rounded-[16px] bg-[var(--color-secondary-bg)] px-[16px] py-[14px]"
          >
            <TelegramIcon />
            <span className="min-w-0 flex-1">
              <span className="block font-montserrat text-[15px] font-black tracking-[-0.2px] text-black">
                Закрытый чат гостей
              </span>
              <span className="block font-sans text-[13px] leading-[17px] text-[var(--color-muted)]">
                Доступен в статусе ВИП
              </span>
            </span>
            <span className="font-sans text-[20px] text-[var(--color-muted)]">›</span>
          </a>
        )}

        {/* История */}
        <h2 className="animate-rise stagger-6 mt-[24px] font-montserrat text-[22px] font-black tracking-[-0.4px] text-black">
          История
        </h2>

        {txns === null ? (
          <p className="py-[24px] text-center font-sans text-[15px] text-[var(--color-muted)]">
            Загрузка…
          </p>
        ) : txns.length === 0 ? (
          <p className="py-[24px] text-center font-sans text-[15px] text-[var(--color-muted)]">
            Пока нет операций
          </p>
        ) : (
          <>
            <ul className="animate-rise stagger-6 mt-[8px]">
              {txns.map((t, i) => (
                <li key={t.id}>
                  {i > 0 && <div className="ml-[34px] h-px bg-black/[0.06]" />}
                  <Row txn={t} />
                </li>
              ))}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="tap mt-[12px] w-full rounded-[16px] bg-[var(--color-secondary-bg)] py-[12px] text-center font-sans text-[15px] tracking-[-0.2px] text-black disabled:opacity-60"
              >
                {loadingMore ? "Загрузка…" : "Показать ещё"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Кнопка «Выйти» закреплена внизу экрана (не скроллится с историей) */}
      <div className="shrink-0 border-t border-black/[0.06] bg-white px-[24px] pt-[12px] pb-[20px]">
        <button
          type="button"
          onClick={onLogout}
          className="tap w-full rounded-[16px] bg-white py-[14px] text-center font-sans text-[16px] tracking-[-0.2px] text-[#FF3B30]"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

/** Иконка Telegram для ссылки на закрытый чат ВИП. */
function TelegramIcon() {
  return (
    <span
      className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-[#2AABEE]"
      aria-hidden
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M4.6 11.5 19 5.7c.8-.3 1.5.2 1.3 1.1l-2.5 11.6c-.2.8-.7 1-1.4.6l-3.8-2.8-1.8 1.8c-.2.2-.4.4-.8.4l.3-4 7.2-6.5c.3-.3-.1-.4-.5-.2l-8.9 5.6-3.8-1.2c-.8-.3-.8-.8.1-1.2Z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center">
      <span className="font-montserrat text-[26px] font-black leading-[30px] tracking-[-0.4px] text-black">
        {value}
      </span>
      <span className="font-sans text-[13px] leading-[16px] text-black/60">
        {label}
      </span>
    </div>
  );
}

function Row({ txn }: { txn: Transaction }) {
  const accrual = txn.kind === "accrual";
  return (
    <div className="flex items-center gap-[12px] py-[12px]">
      <Chevron accrual={accrual} />
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[16px] leading-[20px] tracking-[-0.2px] text-black">
          {accrual ? "Начисление" : "Списание"}
        </p>
        <p className="font-sans text-[13px] leading-[17px] text-[var(--color-muted)]">
          {dayMonth(txn.date)}
        </p>
      </div>
      <span
        className={`font-montserrat text-[18px] font-black tracking-[-0.2px] ${
          accrual ? "text-black" : "text-[var(--color-muted)]"
        }`}
      >
        {accrual ? "+ " : "- "}
        {fmt(Math.abs(txn.points))}
      </span>
    </div>
  );
}

/** Зелёный шеврон вверх = начисление, серый вниз = списание. */
function Chevron({ accrual }: { accrual: boolean }) {
  return (
    <span
      className={`flex size-[22px] shrink-0 items-center justify-center ${
        accrual ? "text-[var(--color-accrual)]" : "text-[#C4C7CC]"
      }`}
      aria-hidden
    >
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d={accrual ? "M5 14l6-6 6 6" : "M5 8l6 6 6-6"}
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
