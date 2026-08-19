import { useEffect } from "react";
import {
  CONTENDER_THRESHOLD,
  STANDARD_CASHBACK,
  PRO_CASHBACK,
} from "../services/loyalty";

/**
 * Модальное окно с условиями программы лояльности — простым языком.
 * Открывается кнопкой «Условия программы» на карте.
 */
export default function RulesModal({ onClose }: { onClose: () => void }) {
  // Закрытие по Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="animate-rise absolute inset-0 z-50 flex items-end justify-center bg-black/40 p-0"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-[28px] bg-white px-[28px] pt-[12px] pb-[32px] shadow-[0_-8px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Грабер */}
        <div className="mx-auto mb-[18px] h-[5px] w-[40px] rounded-full bg-black/15" />

        <h2 className="font-montserrat text-[22px] font-black tracking-[-0.4px] text-black">
          Условия программы
        </h2>

        <div className="mt-[18px] flex flex-col gap-[16px]">
          {/* СТАНДАРТ */}
          <div className="flex gap-[14px]">
            <LevelDot className="bg-[var(--color-standard-card)]" />
            <div>
              <p className="font-montserrat text-[16px] font-black tracking-[-0.2px] text-black">
                Стандарт · {STANDARD_CASHBACK}%
              </p>
              <p className="mt-[2px] font-sans text-[14px] leading-[19px] text-[var(--color-muted)]">
                Базовый уровень — он есть у всех гостей. Возвращаем{" "}
                {STANDARD_CASHBACK}% баллами с каждой покупки.
              </p>
            </div>
          </div>

          {/* ПРЕТЕНДЕНТ НА ВИП */}
          <div className="flex gap-[14px]">
            <LevelDot className="bg-[var(--color-contender)]" />
            <div>
              <p className="font-montserrat text-[16px] font-black tracking-[-0.2px] text-black">
                Претендент на ВИП
              </p>
              <p className="mt-[2px] font-sans text-[14px] leading-[19px] text-[var(--color-muted)]">
                {CONTENDER_THRESHOLD} визитов за последние 30 дней. Статус
                действует текущий месяц и весь следующий. Чтобы получить ВИП —
                загляните в кофейню, его подключат на кассе.
              </p>
            </div>
          </div>

          {/* ВИП */}
          <div className="flex gap-[14px]">
            <LevelDot className="bg-[var(--color-pro)]" />
            <div>
              <p className="font-montserrat text-[16px] font-black tracking-[-0.2px] text-black">
                ВИП · {PRO_CASHBACK}%
              </p>
              <p className="mt-[2px] font-sans text-[14px] leading-[19px] text-[var(--color-muted)]">
                Кэшбек {PRO_CASHBACK}% навсегда: статус ВИП остаётся с вами и не
                понижается обратно, сколько бы вы ни заходили.
              </p>
            </div>
          </div>
        </div>

        {/* Привилегии ВИП */}
        <div className="mt-[18px] rounded-[16px] bg-[var(--color-secondary-bg)] px-[16px] py-[16px]">
          <p className="font-montserrat text-[15px] font-black tracking-[-0.2px] text-black">
            Что ещё даёт ВИП
          </p>
          <ul className="mt-[10px] flex flex-col gap-[10px]">
            <li className="flex gap-[10px]">
              <Bullet />
              <span className="font-sans text-[14px] leading-[19px] text-black">
                Доступ в закрытый чат гостей кофейни
              </span>
            </li>
            <li className="flex gap-[10px]">
              <Bullet />
              <span className="font-sans text-[14px] leading-[19px] text-black">
                Уникальные предложения в меню
              </span>
            </li>
          </ul>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-[22px] h-[54px] w-full rounded-full bg-black font-sans text-[17px] font-semibold tracking-[-0.4px] text-white shadow-[0_6px_20px_rgba(0,0,0,0.18)] active:opacity-80"
        >
          Понятно
        </button>
      </div>
    </div>
  );
}

/** Золотая галочка-маркер привилегии ВИП. */
function Bullet() {
  return (
    <svg
      className="mt-[2px] size-[16px] shrink-0 text-[var(--color-pro)]"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M3.5 8.5 6.5 11.5 12.5 5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LevelDot({ className }: { className: string }) {
  return (
    <span
      className={`mt-[4px] size-[14px] shrink-0 rounded-full ${className}`}
      aria-hidden
    />
  );
}
