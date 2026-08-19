import type { Customer, LoyaltyStatus } from "./types";

export type { LoyaltyStatus };

/** Визитов за последние 30 дней для статуса «Претендент на ВИП». */
export const CONTENDER_THRESHOLD = 7;

/** Окно подсчёта визитов, дней. */
export const PURCHASE_WINDOW_DAYS = 30;

/** Кэшбек уровней, %. */
export const STANDARD_CASHBACK = 10;
export const PRO_CASHBACK = 15;

/** Закрытый чат гостей — доступен только в статусе ВИП. */
export const PRO_CHAT_URL = "https://t.me/+5tMB8yy0K9U1YTAy";

/**
 * Уровень гостя. Считает бэкенд (он же помнит момент достижения и срок
 * действия статуса претендента), здесь — только запасной вариант для моков.
 */
export function loyaltyStatus(c: Customer): LoyaltyStatus {
  if (c.status) return c.status;
  if (cashbackFromCategory(c.category) >= PRO_CASHBACK) return "pro";
  return (c.purchasesThisMonth ?? 0) >= CONTENDER_THRESHOLD
    ? "contender"
    : "standard";
}

/** Подпись уровня для экранов (только кириллица). */
export function statusLabel(s: LoyaltyStatus): string {
  if (s === "pro") return "ВИП";
  if (s === "contender") return "ПРЕТЕНДЕНТ";
  return "СТАНДАРТ";
}

/** Извлечь процент кэшбека из названия категории ("Cashback 10%" → 10). */
export function cashbackFromCategory(category: string | null): number {
  const m = category?.match(/(\d+)\s*%/);
  return m ? Number(m[1]) : 0;
}

/**
 * Кэшбек, который показываем гостю: у ВИП — 15%, у остальных — базовые 10%.
 * Не берём процент из категории напрямую: у части гостей в iiko категория
 * отсутствует или названа иначе, и в приложении вылезал бы 0% или 5%.
 */
export function displayCashback(s: LoyaltyStatus): number {
  return s === "pro" ? PRO_CASHBACK : STANDARD_CASHBACK;
}

/**
 * «31 августа» — последний день действия статуса претендента.
 * Формат строго в UTC: срок хранится как 23:59:59.999Z, и в местном поясе
 * (МСК = UTC+3) он бы перескочил на следующий день.
 */
export function untilLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
