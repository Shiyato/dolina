import { useEffect } from "react";
import { untilLabel, PRO_CASHBACK } from "../services/loyalty";

/**
 * Модал «вы стали претендентом на ВИП». Показывается один раз — в момент,
 * когда гость впервые набрал 7 визитов за 30 дней. Главная мысль: статус уже
 * есть, но чтобы получить ВИП, нужно прийти в кофейню (категорию ставят на кассе).
 */
export default function ContenderModal({
  contenderUntil,
  onClose,
}: {
  contenderUntil: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const until = untilLabel(contenderUntil);

  return (
    <div
      className="animate-rise absolute inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-[28px] bg-white px-[28px] pt-[12px] pb-[32px] shadow-[0_-8px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-[18px] h-[5px] w-[40px] rounded-full bg-black/15" />

        {/* Бронзовый бейдж статуса */}
        <div
          className="mx-auto flex size-[64px] items-center justify-center rounded-full"
          style={{ backgroundImage: "var(--gradient-contender)" }}
          aria-hidden
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9l6-.9L12 3.5Z"
              fill="#fff"
            />
          </svg>
        </div>

        <h2 className="mt-[14px] text-center font-montserrat text-[24px] font-black tracking-[-0.4px] text-black">
          Вы претендент на ВИП
        </h2>
        <p className="mt-[10px] text-center font-sans text-[15px] leading-[21px] text-[var(--color-muted)]">
          Вы сделали 7 визитов за последние 30 дней. Чтобы получить{" "}
          <span className="font-semibold text-black">ВИП и {PRO_CASHBACK}% кэшбека</span>,
          загляните в кофейню — статус подключат на кассе.
        </p>
        {until && (
          <p className="mt-[10px] text-center font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
            Статус претендента действует до {until}.
          </p>
        )}

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
