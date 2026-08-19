import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Журнал операций (начисления/списания). iikoCloud API не отдаёт историю
 * транзакций напрямую, поэтому ведём свою: наполняется вебхуками iiko и нашими
 * вызовами topup/chargeoff. Хранилище — JSON-файл (в Docker на volume).
 *
 * Для нагрузки посерьёзнее это заменяется на БД (Postgres/SQLite) — интерфейс
 * функций менять не придётся.
 */

export interface JournalEntry {
  id: string;
  /** ID гостя в iiko. */
  customerId: string;
  /** ISO-время операции. */
  date: string;
  /** Начисление (+) или списание (−). */
  kind: "accrual" | "redemption";
  /** Изменение баллов (со знаком). */
  points: number;
  /** Сумма чека, ₽ (если известна). */
  orderSum: number | null;
  /** Заведение. */
  place: string | null;
  /** Источник записи. */
  source: "webhook" | "api";
}

let queue: Promise<void> = Promise.resolve();

async function readAll(): Promise<JournalEntry[]> {
  try {
    const raw = await fs.readFile(config.journalPath, "utf8");
    return JSON.parse(raw) as JournalEntry[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/** Сериализуем записи, чтобы избежать гонок при конкурентной записи. */
function enqueue<T>(task: (entries: JournalEntry[]) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    const entries = await readAll();
    const result = await task(entries);
    return result;
  });
  // Хвост очереди не должен падать из-за ошибки одной операции.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Добавить запись в журнал. */
export function addEntry(entry: JournalEntry): Promise<void> {
  return enqueue(async (entries) => {
    entries.push(entry);
    await fs.mkdir(path.dirname(config.journalPath), { recursive: true });
    await fs.writeFile(config.journalPath, JSON.stringify(entries, null, 2));
  });
}

/** История гостя, новые сверху. */
export function getEntries(customerId: string): Promise<JournalEntry[]> {
  return enqueue((entries) =>
    entries
      .filter((e) => e.customerId === customerId)
      .sort((a, b) => b.date.localeCompare(a.date)),
  );
}

/**
 * Число покупок гостя за последние `days` дней — для уровня лояльности.
 * Покупка = начисление бонусов (accrual): бонусы копятся при оплате чека.
 * Списания (redemption) не считаются покупками.
 */
export function getPurchaseCount(
  customerId: string,
  days = 30,
): Promise<number> {
  const since = Date.now() - days * 86_400_000;
  return enqueue(
    (entries) =>
      entries.filter(
        (e) =>
          e.customerId === customerId &&
          e.kind === "accrual" &&
          new Date(e.date).getTime() >= since,
      ).length,
  );
}
