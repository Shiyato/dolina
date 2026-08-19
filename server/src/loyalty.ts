import { db } from "./admin/db.js";

/**
 * Уровни лояльности гостя для mini-app.
 *
 *   СТАНДАРТ  — базовый, есть у всех.
 *   ПРЕТЕНДЕНТ НА ПРО — 7 визитов за последние 30 дней. Действует до конца
 *                текущего календарного месяца и весь следующий. Чтобы получить
 *                ПРО, гостю нужно прийти в кофейню (категорию ставят на кассе).
 *   ПРО       — у кого в лояльности iiko категория с кэшбеком 15%.
 *                Перманентный: обратно в претенденты/стандарт не опускается.
 *
 * Состояние храним у себя: iiko не помнит ни момент достижения, ни то,
 * показывали ли гостю уведомление.
 */

/** Визитов за 30 дней для статуса «Претендент на ПРО». */
export const CONTENDER_THRESHOLD = 7;

/** Кэшбек, с которого гость считается ПРО. */
export const PRO_CASHBACK = 15;

export type LoyaltyStatus = "standard" | "contender" | "pro";

export interface LoyaltyState {
  status: LoyaltyStatus;
  /** До какого момента действует статус претендента (ISO), иначе null. */
  contenderUntil: string | null;
  /** Показать модал о том, что гость стал претендентом (ещё не показывали). */
  notifyContender: boolean;
}

interface Row {
  customerId: string;
  contenderSince: string | null;
  contenderNotifiedAt: string | null;
  proSince: string | null;
}

const selRow = db.prepare("SELECT * FROM guest_loyalty WHERE customerId = ?");
const upsertContender = db.prepare(`
  INSERT INTO guest_loyalty (customerId, contenderSince, contenderNotifiedAt)
  VALUES (@customerId, @since, @notifiedAt)
  ON CONFLICT(customerId) DO UPDATE SET
    contenderSince = excluded.contenderSince,
    contenderNotifiedAt = excluded.contenderNotifiedAt
`);
const upsertPro = db.prepare(`
  INSERT INTO guest_loyalty (customerId, proSince) VALUES (?, ?)
  ON CONFLICT(customerId) DO UPDATE SET proSince = COALESCE(guest_loyalty.proSince, excluded.proSince)
`);
const markSeen = db.prepare(`
  INSERT INTO guest_loyalty (customerId, contenderNotifiedAt) VALUES (?, ?)
  ON CONFLICT(customerId) DO UPDATE SET contenderNotifiedAt = excluded.contenderNotifiedAt
`);

/** Процент кэшбека из названия категории («VIP Cashback 15%» → 15). */
export function cashbackFromCategory(category: string | null): number {
  const m = category?.match(/(\d+)\s*%/);
  return m ? Number(m[1]) : 0;
}

/**
 * Максимальный кэшбек по всем категориям гостя. Категорий бывает несколько
 * («Cashback 10%» + «VIP Cashback 15%»), и ПРО должен открываться по лучшей.
 */
export function bestCashback(categories: (string | null)[]): number {
  return categories.reduce<number>((max, c) => Math.max(max, cashbackFromCategory(c)), 0);
}

/**
 * Конец действия статуса претендента: последняя миллисекунда СЛЕДУЮЩЕГО
 * календарного месяца после месяца достижения («этот месяц + весь следующий»).
 */
export function contenderExpiry(since: Date): Date {
  // День 0 месяца (m+2) = последний день месяца (m+1).
  return new Date(
    Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 2, 0, 23, 59, 59, 999),
  );
}

/**
 * Посчитать статус гостя и, если нужно, зафиксировать достижение.
 * Вызывается при загрузке карточки гостя в mini-app.
 */
export function resolveLoyalty(params: {
  customerId: string;
  /** Все категории гостя из iiko (не только «главная»). */
  categories: (string | null)[];
  purchases30d: number;
}): LoyaltyState {
  const { customerId, categories, purchases30d } = params;
  const row = (selRow.get(customerId) as Row | undefined) ?? null;
  const now = new Date();

  // ПРО — перманентно: либо ЛЮБАЯ категория даёт 15%, либо ПРО уже выдан раньше.
  if (bestCashback(categories) >= PRO_CASHBACK || row?.proSince) {
    if (!row?.proSince) upsertPro.run(customerId, now.toISOString());
    return { status: "pro", contenderUntil: null, notifyContender: false };
  }

  let since = row?.contenderSince ? new Date(row.contenderSince) : null;
  let notifiedAt = row?.contenderNotifiedAt ?? null;
  let active = since ? now <= contenderExpiry(since) : false;

  if (purchases30d >= CONTENDER_THRESHOLD) {
    // Достижение заново после перерыва — показываем уведомление снова.
    if (!active) notifiedAt = null;
    since = now; // и продлеваем окно, пока гость держит планку
    active = true;
    upsertContender.run({ customerId, since: since.toISOString(), notifiedAt });
  }

  if (!active || !since) {
    return { status: "standard", contenderUntil: null, notifyContender: false };
  }
  return {
    status: "contender",
    contenderUntil: contenderExpiry(since).toISOString(),
    notifyContender: !notifiedAt,
  };
}

/** Отметить, что модал о статусе претендента гостю уже показали. */
export function markContenderNotified(customerId: string): void {
  markSeen.run(customerId, new Date().toISOString());
}
