import { useState } from "react";
import logoWordmark from "../assets/logo-wordmark.svg";
import toggleQr from "../assets/toggle-qr.svg";
import toggleFlame from "../assets/toggle-flame.svg";
import qrFallback from "../assets/qr.png";
import StatusAvatar from "../components/StatusAvatar";
import RulesModal from "../components/RulesModal";
import ContenderModal from "../components/ContenderModal";
import type { Customer } from "../services/types";
import { displayCashback, loyaltyStatus } from "../services/loyalty";
import { API_ENABLED, markContenderSeen, qrUrl } from "../services/api";

/** Форматирование баллов: 1240 → "1 240". */
const fmt = (n: number) => n.toLocaleString("ru-RU").replace(/ /g, " ");

/**
 * Главный экран «Долина кофе» — карта лояльности (Figma node 3:3247).
 * Тап по аватару открывает Профиль. Переключатель QR/бонусы пока отключён.
 *
 * Вёрстка адаптируется по высоте: верхний ряд и кэшбек закреплены сверху/снизу,
 * а средняя зона (баланс + QR + подсказка) гибко ужимается — QR остаётся
 * квадратным, но не выходит за пределы доступной высоты на коротких экранах.
 */
export default function CardScreen({
  customer,
  onOpenProfile,
  onContenderNoticeShown,
}: {
  customer: Customer;
  onOpenProfile: () => void;
  /** Погасить флаг в сессии, чтобы модал не всплыл при возврате на карту. */
  onContenderNoticeShown?: () => void;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const status = loyaltyStatus(customer);
  // Модал о новом статусе — только претенденту и только один раз.
  // Проверка статуса обязательна: у ВИП уведомлению взяться неоткуда.
  const [contenderOpen, setContenderOpen] = useState(
    status === "contender" && customer.notifyContender,
  );

  const closeContender = () => {
    setContenderOpen(false);
    onContenderNoticeShown?.();
    if (API_ENABLED) markContenderSeen(customer.id).catch(() => {});
  };

  const bonus = customer.walletBalances.find((w) => w.type === 1)?.balance ?? 0;
  // QR из бэкенда (реальная карта) при подключённом API; иначе статичный мок.
  const qrSrc =
    API_ENABLED && customer.cardTrack
      ? qrUrl(customer.id, customer.cardTrack)
      : qrFallback;

  return (
    <div className="relative flex h-full flex-col bg-white px-[30px] py-[24px]">
      {/* Верхний ряд: аватар · переключатель · логотип (закреплён сверху) */}
      <div className="animate-rise stagger-1 flex h-[48px] shrink-0 items-center justify-between">
        {/* Аватар → профиль */}
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="Профиль"
          className="tap rounded-full"
        >
          <StatusAvatar
            src={customer.avatarUrl}
            name={customer.name}
            status={status}
            size={42}
            ringWidth={3}
          />
        </button>

        {/* Переключатель QR / заказ временно скрыт (нет онлайн-оплаты).
            Место сохранено, чтобы верхний ряд оставался сбалансированным. */}
        <div
          aria-hidden="true"
          className="invisible relative flex h-[48px] w-[133px] items-center rounded-full bg-[var(--color-avatar)] px-[5px]"
        >
          <span className="absolute top-[5px] left-[5px] h-[37px] w-[60px] rounded-full bg-white shadow-sm" />
          <div className="relative z-10 flex h-[37px] w-[60px] items-center justify-center">
            <img src={toggleQr} alt="" className="size-[28px]" />
          </div>
          <div className="relative z-10 flex h-[37px] w-[60px] items-center justify-center">
            <img src={toggleFlame} alt="" className="h-[22px] w-[19px]" />
          </div>
        </div>

        {/* Логотип */}
        <img src={logoWordmark} alt="Долина кофе" className="h-[30px] w-[86px]" />
      </div>

      {/* Средняя зона: гибко занимает всё свободное место между рядом и кэшбеком */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Баланс баллов */}
        <div className="shrink-0 pt-[clamp(20px,5vh,62px)]">
          <p className="animate-pop stagger-2 text-center font-montserrat text-[clamp(44px,13vw,64px)] font-black leading-none tracking-[-0.4px] text-black">
            {fmt(bonus)}
          </p>
          <p className="animate-rise stagger-3 mt-[16px] text-center font-montserrat text-[14px] leading-[22px] tracking-[-0.4px] text-[var(--color-muted)]">
            баллов на счету
          </p>
        </div>

        {/* QR-код: занимает остаток высоты, остаётся квадратным и не переполняет.
            w-full + max-h-full: ширина ограничена контейнером (нет гориз. оверфлоу),
            высота ужимается на коротких экранах. */}
        <div className="flex min-h-0 flex-1 items-center justify-center py-[clamp(12px,3vh,32px)]">
          <div className="animate-pop stagger-4 flex aspect-square max-h-full w-full max-w-full items-center justify-center rounded-[24px] border border-black/[0.06] bg-white p-[clamp(16px,4vw,33px)]">
            <img
              src={qrSrc}
              alt={`QR-код карты ${customer.cardTrack}`}
              className="size-full object-contain"
            />
          </div>
        </div>

        {/* Подсказка */}
        <p className="animate-rise stagger-5 shrink-0 text-center font-montserrat text-[14px] leading-[22px] tracking-[-0.4px] text-[var(--color-muted)]">
          Покажите QR-код на кассе,
          <br />
          чтобы начислить или списать бонусы
        </p>
      </div>

      {/* Кэшбек + условия программы (закреплены снизу) */}
      <div className="animate-rise stagger-6 mt-[20px] shrink-0">
        <div className="flex items-center justify-center gap-[10px]">
          <span className="font-montserrat text-[20px] font-black leading-[22px] tracking-[-0.4px] text-black">
            {displayCashback(status)}%
          </span>
          <span className="font-montserrat text-[20px] leading-[22px] tracking-[-0.4px] text-[var(--color-muted)]">
            текущий кэшбек
          </span>
        </div>
        <button
          type="button"
          onClick={() => setRulesOpen(true)}
          className="tap mt-[14px] h-[50px] w-full rounded-full bg-[var(--color-secondary-bg)] font-sans text-[16px] font-semibold tracking-[-0.3px] text-black"
        >
          Условия программы
        </button>
      </div>

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
      {contenderOpen && (
        <ContenderModal
          contenderUntil={customer.contenderUntil}
          onClose={closeContender}
        />
      )}
    </div>
  );
}
