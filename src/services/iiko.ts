import type { Customer, Transaction } from "./types";
import { MOCK_CUSTOMER, MOCK_TRANSACTIONS } from "./mockData";
import { cashbackFromCategory } from "./loyalty";
import {
  API_ENABLED,
  fetchCustomerByPhone,
  fetchTransactions,
  type ApiCustomer,
  type ApiTransaction,
} from "./api";

/**
 * Сейм к данным лояльности. В проде ходит в наш backend (server/), который
 * проксирует iikoCloud. В dev (без VITE_API_BASE) — мок. Экраны используют
 * только эти функции и доменный тип Customer.
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ApiCustomer (ответ бэкенда) → доменный Customer. */
function mapCustomer(a: ApiCustomer): Customer {
  const fullName = [a.name, a.surname].filter(Boolean).join(" ").trim();
  return {
    id: a.id,
    name: fullName || "Гость",
    phone: a.phone ?? "",
    avatarUrl: null, // приходит из VK, мержится в AuthContext
    cardTrack: a.cardTrack ?? "",
    cashbackPercent: cashbackFromCategory(a.category),
    category: a.category,
    // Покупки за 30 дней из журнала бэкенда — определяют уровень.
    purchasesThisMonth: a.purchases30d,
    status: a.status ?? null,
    contenderUntil: a.contenderUntil ?? null,
    notifyContender: a.notifyContender ?? false,
    walletBalances: [
      // Бэкенд суммирует бонусные кошельки в balance; отдаём одним type:1.
      { id: a.walletId ?? "bonus", name: "Бонусы", type: 1, balance: a.balance },
    ],
  };
}

function mapTransaction(t: ApiTransaction): Transaction {
  return {
    id: t.id,
    date: t.date,
    kind: t.kind,
    place: t.place ?? "Долина Кофе",
    orderSum: t.orderSum ?? 0,
    points: t.points,
  };
}

/**
 * Поиск гостя по телефону — ключевой метод авторизации.
 * Возвращает null, если гость не найден (не зарегистрирован в лояльности).
 */
export async function getCustomerByPhone(
  phone: string,
): Promise<Customer | null> {
  if (API_ENABLED) {
    const a = await fetchCustomerByPhone(phone);
    return a ? mapCustomer(a) : null;
  }
  await delay(600);
  return phone === MOCK_CUSTOMER.phone ? MOCK_CUSTOMER : null;
}

/** Актуальные данные гостя (для восстановления сессии). Ищем по телефону. */
export async function getCustomerByPhoneForSession(
  phone: string,
): Promise<Customer | null> {
  return getCustomerByPhone(phone);
}

/** Страница истории операций для экрана Профиль. */
export interface TransactionsResult {
  items: Transaction[];
  hasMore: boolean;
}

/** История операций (из iiko, окно 90 дней), постранично. */
export async function getTransactions(
  customerId: string,
  page = 0,
  pageSize = 10,
): Promise<TransactionsResult> {
  if (API_ENABLED) {
    const data = await fetchTransactions(customerId, page, pageSize);
    return { items: data.transactions.map(mapTransaction), hasMore: data.hasMore };
  }
  await delay(400);
  const all = customerId === MOCK_CUSTOMER.id ? MOCK_TRANSACTIONS : [];
  const start = page * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    hasMore: start + pageSize < all.length,
  };
}
