import type { Customer, Transaction } from "./types";
import avatarPlaceholder from "../assets/avatar-placeholder.svg";

/** Зарегистрированный гость (мок) — статус ПРЕТЕНДЕНТ (7 визитов). */
export const MOCK_CUSTOMER: Customer = {
  id: "c1a2b3c4-0000-0000-0000-000000000001",
  name: "Артемий",
  phone: "+79991234567",
  // На проде — photo_200 из профиля VK; в моке локальная заглушка.
  avatarUrl: avatarPlaceholder,
  cardTrack: "2000000012408",
  cashbackPercent: 5,
  category: "Cashback 5%",
  purchasesThisMonth: 7,
  status: "contender",
  contenderUntil: "2026-08-31T23:59:59.999Z",
  // По умолчанию НЕ дёргаем модалом на каждой перезагрузке dev-сборки:
  // на проде это разовое событие. Превью модала — по хэшу #demo-contender.
  notifyContender: false,
  walletBalances: [{ id: "w-bonus", name: "Бонусы", type: 1, balance: 1240 }],
};

/** Претендент, которому модал ещё не показывали — превью уведомления. */
export const MOCK_CUSTOMER_CONTENDER_NEW: Customer = {
  ...MOCK_CUSTOMER,
  notifyContender: true,
};

/** Тот же гость в статусе СТАНДАРТ — для DEV-превью второго состояния. */
export const MOCK_CUSTOMER_STANDARD: Customer = {
  ...MOCK_CUSTOMER,
  purchasesThisMonth: 4,
  status: "standard",
  contenderUntil: null,
  notifyContender: false,
  walletBalances: [{ id: "w-bonus", name: "Бонусы", type: 1, balance: 124 }],
};

/** Гость в статусе ВИП — для DEV-превью (#profile-pro). */
export const MOCK_CUSTOMER_PRO: Customer = {
  ...MOCK_CUSTOMER,
  cashbackPercent: 15,
  category: "Cashback 15%",
  purchasesThisMonth: 12,
  status: "pro",
  contenderUntil: null,
  notifyContender: false,
};

/** Журнал операций (мок). На проде — из БД backend (вебхуки iiko). */
export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: "t10", date: "2026-07-16T09:12:00+03:00", kind: "accrual",    place: "Долина Кофе, Тверская", orderSum: 480, points: 42 },
  { id: "t9",  date: "2026-07-16T18:40:00+03:00", kind: "redemption", place: "Долина Кофе, Тверская", orderSum: 320, points: -150 },
  { id: "t8",  date: "2026-07-15T08:05:00+03:00", kind: "accrual",    place: "Долина Кофе, Арбат",    orderSum: 420, points: 42 },
  { id: "t7",  date: "2026-07-10T13:20:00+03:00", kind: "accrual",    place: "Долина Кофе, Арбат",    orderSum: 360, points: 36 },
  { id: "t6",  date: "2026-07-08T10:33:00+03:00", kind: "redemption", place: "Долина Кофе, Тверская", orderSum: 150, points: -150 },
  { id: "t5",  date: "2026-07-05T16:47:00+03:00", kind: "accrual",    place: "Долина Кофе, Тверская", orderSum: 720, points: 72 },
  { id: "t4",  date: "2026-06-30T09:00:00+03:00", kind: "accrual",    place: "Долина Кофе, Арбат",    orderSum: 390, points: 39 },
];
