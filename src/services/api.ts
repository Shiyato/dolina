/**
 * HTTP-клиент к нашему бэкенду (server/). В проде фронт и API на одном домене,
 * поэтому база пустая → запросы идут на /api (same-origin, nginx проксирует).
 * Для локальной разработки против прод-API можно задать VITE_API_BASE.
 */

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

/** Реальный бэкенд включён в проде или когда явно задан VITE_API_BASE. */
export const API_ENABLED: boolean =
  import.meta.env.PROD || Boolean(import.meta.env.VITE_API_BASE);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = (body as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

/** Ответ GET /api/customer. */
export interface ApiCustomer {
  id: string;
  name: string | null;
  surname: string | null;
  phone: string | null;
  category: string | null;
  cardTrack: string | null;
  balance: number;
  /** Покупок за последние 30 дней — для уровня лояльности. */
  purchases30d: number;
  /** Уровень лояльности, посчитанный бэкендом. */
  status: "standard" | "contender" | "pro";
  /** До какого момента действует статус претендента (ISO), иначе null. */
  contenderUntil: string | null;
  /** Нужно показать модал «вы стали претендентом» (ещё не показывали). */
  notifyContender: boolean;
  walletId: string | null;
  wallets: { id: string; name: string; balance: number }[];
}

export interface ApiTransaction {
  id: string;
  customerId: string;
  date: string;
  kind: "accrual" | "redemption";
  points: number;
  orderSum: number | null;
  place: string | null;
  source: "iiko" | "webhook" | "api";
}

/** Гость по телефону. 404 → null (не зарегистрирован). */
export async function fetchCustomerByPhone(
  phone: string,
): Promise<ApiCustomer | null> {
  try {
    return await request<ApiCustomer>(
      `/customer?phone=${encodeURIComponent(phone)}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Страница истории операций гостя (из iiko, окно 90 дней). */
export interface TransactionsPage {
  transactions: ApiTransaction[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/** История операций гостя, постранично. */
export async function fetchTransactions(
  customerId: string,
  page = 0,
  pageSize = 10,
): Promise<TransactionsPage> {
  return request<TransactionsPage>(
    `/customer/${encodeURIComponent(customerId)}/transactions?page=${page}&pageSize=${pageSize}`,
  );
}

/** Отметить, что модал «вы стали претендентом на ВИП» гостю показан. */
export async function markContenderSeen(customerId: string): Promise<void> {
  await fetch(
    `${API_BASE}/api/customer/${encodeURIComponent(customerId)}/contender-seen`,
    { method: "POST" },
  );
}

/** URL картинки QR карты (для <img src>). */
export function qrUrl(customerId: string, cardTrack: string): string {
  return `${API_BASE}/api/customer/${encodeURIComponent(
    customerId,
  )}/qr?content=${encodeURIComponent(cardTrack)}`;
}

/** Адрес и координаты кофейни. */
export interface Venue {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Данные кофейни для кнопки «Найти на карте». null при ошибке. */
export async function fetchVenue(): Promise<Venue | null> {
  try {
    return await request<Venue>("/venue");
  } catch {
    return null;
  }
}

// ── Дистанционный заказ (панель «огонёк») ────────────────────────
export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  kind: "drink" | "food" | "other";
  description?: string;
}
export interface MenuCategory {
  name: string;
  items: MenuItem[];
}
export interface OrderMenu {
  source: "local" | "external" | "empty";
  updatedAt: string;
  categories: MenuCategory[];
}
export interface FavoriteItem {
  productId: string;
  name: string;
  kind: string;
  orders: number;
}
export interface Favorites {
  drinks: FavoriteItem[];
  food: FavoriteItem[];
}
export interface OrderResult {
  ok: boolean;
  orderNumber: string;
  status: string;
  paid: boolean;
  total: number;
  mode: "live" | "stub";
}

/** Меню для заказа. В dev без API — демо-набор, чтобы видеть интерфейс. */
export async function fetchMenu(): Promise<OrderMenu> {
  if (!API_ENABLED) return DEMO_MENU;
  return request<OrderMenu>("/menu");
}

/** Любимые позиции гостя. Пока данных мало — обычно пусто. */
export async function fetchFavorites(customerId: string): Promise<Favorites> {
  if (!API_ENABLED) return { drinks: [], food: [] };
  try {
    return await request<Favorites>(
      `/customer/${encodeURIComponent(customerId)}/favorites`,
    );
  } catch {
    return { drinks: [], food: [] };
  }
}

/** Оформить заказ. В dev без API — имитация успешной оплаты. */
export async function submitOrder(body: {
  customerId: string;
  phone?: string | null;
  items: { id: string; name: string; price: number; amount: number }[];
  comment?: string;
}): Promise<OrderResult> {
  const total = body.items.reduce((s, i) => s + i.price * i.amount, 0);
  if (!API_ENABLED) {
    await new Promise((r) => setTimeout(r, 700));
    return {
      ok: true,
      orderNumber: String(Math.floor(100 + Math.random() * 900)),
      status: "accepted",
      paid: true,
      total,
      mode: "stub",
    };
  }
  const res = await fetch(`${API_BASE}/api/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError("order_failed", res.status);
  return (await res.json()) as OrderResult;
}

/** Демо-меню для dev-превью (когда бэкенд отключён). */
const DEMO_MENU: OrderMenu = {
  source: "local",
  updatedAt: "",
  categories: [
    {
      name: "Кофе",
      items: [
        { id: "d1", name: "Американо 200", price: 170, category: "Кофе", kind: "drink" },
        { id: "d2", name: "Латте тыква 400", price: 200, category: "Кофе", kind: "drink" },
        { id: "d3", name: "Сырный латте 300", price: 240, category: "Кофе", kind: "drink" },
        { id: "d4", name: "Эспрессо 50", price: 150, category: "Кофе", kind: "drink" },
      ],
    },
    {
      name: "Сендвичи",
      items: [
        { id: "f1", name: "Сандо с курицей", price: 390, category: "Сендвичи", kind: "food" },
        { id: "f2", name: "Кацу Сандо", price: 390, category: "Сендвичи", kind: "food" },
        { id: "f3", name: "Сандо с говядиной", price: 460, category: "Сендвичи", kind: "food" },
        { id: "f4", name: "Сандо ЧизБургер", price: 310, category: "Сендвичи", kind: "food" },
      ],
    },
    {
      name: "Холодные напитки",
      items: [
        { id: "c1", name: "Матча-манго 300", price: 320, category: "Холодные напитки", kind: "drink" },
        { id: "c2", name: "Орео баббл 300", price: 320, category: "Холодные напитки", kind: "drink" },
      ],
    },
  ],
};
