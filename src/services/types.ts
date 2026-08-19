/** Доменные типы. Согласованы с полями iikoCloud API, чтобы при подключении
 *  реального backend экраны не пришлось переписывать. */

/** Кошелёк гостя из iiko (walletBalances[]). */
export interface WalletBalance {
  id: string;
  name: string;
  /** 0 депозит · 1 бонусная · 2 продуктовая · 3 скидочная · 4 сертификаты */
  type: number;
  balance: number;
}

/** Гость (ответ /loyalty/iiko/customer/info). */
export interface Customer {
  id: string;
  name: string;
  /** Телефон в формате +7XXXXXXXXXX — ключ связи VK ↔ iiko. */
  phone: string;
  /** Аватар из профиля VK (photo_200). null, если не выдан. */
  avatarUrl: string | null;
  /** Трек карты, зашивается в QR для сканирования на кассе. */
  cardTrack: string;
  /** Текущий кэшбек, % (уровень лояльности). Выводится из категории iiko. */
  cashbackPercent: number;
  /** Категория гостя из iiko (напр. "Cashback 10%"). */
  category: string | null;
  /**
   * Покупок за текущий месяц. iikoCloud customer/info это НЕ отдаёт, поэтому
   * при работе с реальным API — null (статус считаем по кэшбеку). В моке — число.
   */
  purchasesThisMonth: number | null;
  /**
   * Уровень лояльности с бэкенда: стандарт / претендент на ВИП / ВИП.
   * null — считаем на клиенте (моки в dev).
   */
  status: LoyaltyStatus | null;
  /** До какого момента действует статус претендента (ISO), иначе null. */
  contenderUntil: string | null;
  /** Показать модал «вы стали претендентом» — гостю его ещё не показывали. */
  notifyContender: boolean;
  walletBalances: WalletBalance[];
}

/**
 * Уровни: СТАНДАРТ (базовый) → ПРЕТЕНДЕНТ НА ВИП (7 визитов за 30 дней,
 * действует этот месяц + следующий) → ВИП (категория 15% в iiko, навсегда).
 */
export type LoyaltyStatus = "standard" | "contender" | "pro";

/** Одна операция журнала (начисление/списание). Собирается backend'ом из
 *  вебхуков iiko — прямого метода в API нет (см. DOCS.md §4). */
export interface Transaction {
  id: string;
  /** ISO-дата операции. */
  date: string;
  /** Тип: начисление (+) или списание (−). */
  kind: "accrual" | "redemption";
  /** Заведение, где прошла операция. */
  place: string;
  /** Сумма чека, ₽. */
  orderSum: number;
  /** Изменение баланса баллов (со знаком). */
  points: number;
}

/** Результат авторизации через VK по номеру телефона. */
export type AuthResult =
  | { registered: true; customer: Customer }
  | { registered: false; phone: string };
