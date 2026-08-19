import { config, iikoAuthMode } from "./config.js";

/**
 * Клиент iikoCloud API (iikoTransport, api-ru.iiko.services).
 * Поддерживает два флоу получения токена:
 *   v1 — обычный ресторанный ключ:  POST /api/1/access_token  { apiLogin }
 *   v2 — partner/marketplace:       POST /api/v2/access_token { apiKey, clientSecret, appId }
 * Токен кэшируется (живёт ~1 час), автоматически обновляется.
 */

interface WalletBalance {
  id: string;
  name: string;
  type: number; // 0 депозит · 1 бонусная · 2 продуктовая · 3 скидочная · 4 сертификаты
  balance: number;
}

export interface IikoCustomer {
  id: string;
  name: string | null;
  surname: string | null;
  phone: string | null;
  /** Самая выгодная категория гостя (напр. "VIP Cashback 15%"). */
  category: string | null;
  /** Все активные категории гостя — их может быть несколько. */
  categories: string[];
  cards: { id: string; track: string; number: string }[];
  walletBalances: WalletBalance[];
}

/** Транзакция гостя из /customer/transactions/by_date. */
export interface IikoTransaction {
  id: string;
  type: number;
  /** Тип операции: "CloseOrder" (покупка), "RefillWalletFromOrder" (начисление баллов) и др. */
  typeName: string;
  sum: number;
  orderSum: number | null;
  orderNumber: number | null;
  /** Кошелёк (не null для операций с баллами). */
  walletId: string | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  /** Время операции (UTC), "yyyy-MM-dd HH:mm:ss.fff". */
  whenCreated: string;
  comment: string | null;
}

class IikoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}
export { IikoError };

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedOrgId: string | null = config.iiko.organizationId || null;

/** Таймаут одного запроса к iiko: без него зависший ответ вешает воркер. */
const REQUEST_TIMEOUT_MS = 20_000;

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(config.iiko.base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const desc =
      (data as { errorDescription?: string; error?: string }).errorDescription ??
      (data as { error?: string }).error ??
      res.statusText;
    throw new IikoError(`iiko ${path}: ${desc}`, res.status, data);
  }
  return data as T;
}

/** Получить (или переиспользовать закэшированный) access token. */
export async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const mode = iikoAuthMode();
  let resp: { token: string };
  if (mode === "v2") {
    resp = await post<{ token: string }>("/api/v2/access_token", {
      apiKey: config.iiko.apiKey || config.iiko.apiLogin,
      clientSecret: config.iiko.clientSecret,
      appId: config.iiko.appId,
    });
  } else {
    resp = await post<{ token: string }>("/api/1/access_token", {
      apiLogin: config.iiko.apiLogin,
    });
  }
  // Токен живёт 1 час; обновим на 5 минут раньше.
  cachedToken = { value: resp.token, expiresAt: Date.now() + 55 * 60_000 };
  return resp.token;
}

/** ID организации лояльности (из env или первая доступная). */
export async function getOrganizationId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const token = await getToken();
  const data = await post<{ organizations: { id: string; name: string }[] }>(
    "/api/1/organizations",
    { returnAdditionalInfo: false, includeDisabled: false },
    token,
  );
  const first = data.organizations?.[0];
  if (!first) throw new IikoError("Нет доступных организаций", 404);
  cachedOrgId = first.id;
  return cachedOrgId;
}

export interface IikoVenue {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

let cachedVenue: IikoVenue | null = null;

/** Адрес и координаты кофейни (для кнопки «Найти на карте»). Кэшируется. */
export async function getVenue(): Promise<IikoVenue> {
  if (cachedVenue) return cachedVenue;
  const token = await getToken();
  const data = await post<{
    organizations: {
      id: string;
      name: string;
      restaurantAddress?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
    }[];
  }>(
    "/api/1/organizations",
    { returnAdditionalInfo: true, includeDisabled: false },
    token,
  );
  // Берём именно организацию лояльности «Долина Кофе», а не первую попавшуюся
  // (первой у iiko идёт точка «Сандо»).
  const orgId = await getOrganizationId();
  const o =
    data.organizations?.find((x) => x.id === orgId) ?? data.organizations?.[0];
  if (!o) throw new IikoError("Нет доступных организаций", 404);
  cachedVenue = {
    name: VENUE_NAME,
    // Адрес и координаты фиксируем: iiko отдаёт устаревшую точку. См. VENUE_ADDRESS.
    address: VENUE_ADDRESS,
    latitude: venueCoord(process.env.VENUE_LAT, o.latitude),
    longitude: venueCoord(process.env.VENUE_LON, o.longitude),
  };
  return cachedVenue;
}

/**
 * Актуальный адрес кофейни. iiko отдаёт устаревшую точку (другой город,
 * координаты 0,0), поэтому фиксируем здесь. Переопределяется через env
 * VENUE_ADDRESS / VENUE_LAT / VENUE_LON.
 */
const VENUE_ADDRESS = process.env.VENUE_ADDRESS ?? "Ульяновск, Дворцовая ул., 8";

/** Название кофейни. iiko отдаёт «Долина Кофе - Сандо» — фиксируем короткое. */
const VENUE_NAME = process.env.VENUE_NAME ?? "Долина Кофе";

/** env-координата, иначе значение iiko; 0 или невалид → null (тогда карта ищет по адресу). */
function venueCoord(envVal: string | undefined, iikoVal: number | undefined): number | null {
  const v = envVal != null && envVal !== "" ? Number(envVal) : iikoVal;
  return typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;
}

/**
 * Данные гостя по любому критерию. type ∈ phone|id|cardTrack|cardNumber|email
 * (проверено на живом API). Поле-значение кладём под именем type.
 */
async function customerInfo(
  type: "phone" | "id" | "cardTrack" | "cardNumber" | "email",
  value: string,
): Promise<IikoCustomer | null> {
  const token = await getToken();
  const organizationId = await getOrganizationId();
  try {
    const data = await post<{
      id: string;
      name?: string;
      surname?: string;
      phone?: string;
      cards?: { id: string; track?: string; number?: string }[];
      categories?: { id: string; name: string; isActive: boolean }[];
      walletBalances?: WalletBalance[];
    }>(
      "/api/1/loyalty/iiko/customer/info",
      { organizationId, type, [type]: value },
      token,
    );
    // Категорий у гостя может быть несколько (напр. «Cashback 10%» и
    // «VIP Cashback 15%»). Брать первую попавшуюся нельзя — так можно потерять
    // 15% и не открыть ПРО. Отдаём все, а «главной» считаем самую выгодную.
    const names = (data.categories ?? [])
      .filter((c) => c.isActive !== false)
      .map((c) => c.name)
      .filter(Boolean);
    const pct = (s: string) => {
      const m = s.match(/(\d+)\s*%/);
      return m ? Number(m[1]) : -1;
    };
    const best =
      names.length > 0
        ? names.reduce((a, b) => (pct(b) > pct(a) ? b : a))
        : null;
    return {
      id: data.id,
      name: data.name ?? null,
      surname: data.surname ?? null,
      phone: data.phone ?? (type === "phone" ? value : null),
      category: best,
      categories: names,
      cards: (data.cards ?? []).map((c) => ({
        id: c.id,
        track: c.track ?? c.number ?? "",
        number: c.number ?? c.track ?? "",
      })),
      walletBalances: data.walletBalances ?? [],
    };
  } catch (e) {
    // Гость не найден — iiko отвечает ошибкой; трактуем как null.
    if (e instanceof IikoError && (e.status === 400 || e.status === 404)) {
      return null;
    }
    throw e;
  }
}

/** Гость по телефону. */
export const getCustomerByPhone = (phone: string) =>
  customerInfo("phone", phone);

/** Гость по iiko-id (из вебхука). Даёт телефон, даже если в чеке его не было. */
export const getCustomerById = (id: string) => customerInfo("id", id);

/** Начислить бонусы на кошелёк гостя. Возвращает id транзакции. */
export async function walletTopup(params: {
  customerId: string;
  walletId: string;
  sum: number;
  comment?: string;
}): Promise<{ transactionId: string }> {
  const token = await getToken();
  const organizationId = await getOrganizationId();
  const transactionId = crypto.randomUUID();
  await post(
    "/api/1/loyalty/iiko/wallet/topup",
    {
      organizationId,
      customerId: params.customerId,
      walletId: params.walletId,
      sum: params.sum,
      comment: params.comment ?? "Начисление",
      transactionId,
    },
    token,
  );
  return { transactionId };
}

/** Списать бонусы с кошелька гостя. Возвращает id транзакции. */
export async function walletChargeoff(params: {
  customerId: string;
  walletId: string;
  sum: number;
  comment?: string;
}): Promise<{ transactionId: string }> {
  const token = await getToken();
  const organizationId = await getOrganizationId();
  const transactionId = crypto.randomUUID();
  await post(
    "/api/1/loyalty/iiko/wallet/chargeoff",
    {
      organizationId,
      customerId: params.customerId,
      walletId: params.walletId,
      sum: params.sum,
      comment: params.comment ?? "Списание",
      transactionId,
    },
    token,
  );
  return { transactionId };
}

/** UTC-время в формате iiko "yyyy-MM-dd HH:mm:ss.fff". */
function iikoDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
  );
}

/**
 * ВСЕ транзакции гостя за последние `days` дней (для истории и подсчёта
 * покупок). Прямой метод iiko — не требует вебхуков. Постранично выгружает
 * всё за окно (сервер iiko может ограничивать pageSize).
 */
export async function getCustomerTransactions(
  customerId: string,
  days = 90,
): Promise<IikoTransaction[]> {
  const token = await getToken();
  const organizationId = await getOrganizationId();
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const pageSize = 200;
  const all: IikoTransaction[] = [];
  for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
    const data = await post<{ transactions?: IikoTransaction[] }>(
      "/api/1/loyalty/iiko/customer/transactions/by_date",
      {
        customerId,
        dateFrom: iikoDate(from),
        dateTo: iikoDate(now),
        pageNumber,
        pageSize,
        organizationId,
      },
      token,
    );
    const chunk = data.transactions ?? [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

/** Позиция номенклатуры: продукт + его группа (нужна для «напиток/блюдо»). */
export interface IikoProduct {
  id: string;
  name: string;
  groupName: string | null;
  categoryName: string | null;
}

/**
 * Номенклатура организации: блюда/напитки с названием группы и категории.
 * Нужна, чтобы отличать напиток от блюда (в чеке приходит только id+name).
 */
export async function getNomenclature(): Promise<IikoProduct[]> {
  const token = await getToken();
  const organizationId = await getOrganizationId();
  const data = await post<{
    groups?: { id: string; name: string }[];
    productCategories?: { id: string; name: string }[];
    products?: {
      id: string;
      name: string;
      groupId: string | null;
      parentGroup: string | null;
      productCategoryId: string | null;
      isDeleted?: boolean;
    }[];
  }>("/api/1/nomenclature", { organizationId }, token);

  const groups = new Map((data.groups ?? []).map((g) => [g.id, g.name]));
  const cats = new Map((data.productCategories ?? []).map((c) => [c.id, c.name]));

  return (data.products ?? [])
    .filter((p) => !p.isDeleted)
    .map((p) => ({
      id: p.id,
      name: p.name,
      groupName: groups.get(p.groupId ?? p.parentGroup ?? "") ?? null,
      categoryName: cats.get(p.productCategoryId ?? "") ?? null,
    }));
}

/** Позиция для создания заказа. */
export interface CreateOrderItem {
  productId: string;
  amount: number;
}

/**
 * Создать заказ в iiko (дистанционный заказ из приложения, самовывоз).
 * Всегда помечаем sourceKey (config.iiko.orderSourceKey) — на кассе заказ виден
 * как пришедший из приложения. Терминал и организация — из конфига.
 */
export async function createOrder(params: {
  items: CreateOrderItem[];
  phone: string;
  comment?: string;
}): Promise<{ id: string; number: string | null; status: string; error: string | null }> {
  const token = await getToken();
  const organizationId = await getOrganizationId();
  const comment = params.comment?.trim();
  const data = await post<{ orderInfo?: { id: string; creationStatus: string } }>(
    "/api/1/order/create",
    {
      organizationId,
      terminalGroupId: config.iiko.terminalGroupId,
      order: {
        phone: params.phone,
        items: params.items.map((i) => ({
          type: "Product",
          productId: i.productId,
          amount: i.amount,
        })),
        ...(comment ? { comment } : {}),
      },
      // Метка источника — заказ из PWA. См. config.iiko.orderSourceKey.
      sourceKey: config.iiko.orderSourceKey,
    },
    token,
  );
  const id = data.orderInfo?.id ?? "";
  let status = data.orderInfo?.creationStatus ?? "unknown";
  // Человекочитаемый номер заказа (для показа гостю) появляется не сразу —
  // опрашиваем order/by_id, пока заказ не примется (или не отклонится).
  let number: string | null = null;
  let error: string | null = null;
  if (id) {
    for (let i = 0; i < 6 && status === "InProgress"; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const info = await getOrderInfo(organizationId, id, token);
      status = info.status;
      number = info.number;
      error = info.error;
    }
  }
  return { id, number, status, error };
}

/** Статус и номер заказа по id (одна попытка). */
async function getOrderInfo(
  organizationId: string,
  orderId: string,
  token: string,
): Promise<{ status: string; number: string | null; error: string | null }> {
  const data = await post<{
    orders?: {
      creationStatus: string;
      errorInfo?: { message?: string } | null;
      order?: { number?: string | number | null } | null;
    }[];
  }>("/api/1/order/by_id", { organizationIds: [organizationId], orderIds: [orderId] }, token);
  const o = data.orders?.[0];
  const num = o?.order?.number;
  return {
    status: o?.creationStatus ?? "unknown",
    number: num != null ? String(num) : null,
    error: o?.errorInfo?.message ?? null,
  };
}

/** Внешнее меню iiko: группа → позиции с ценой (для дистанционного заказа). */
export interface ExternalMenuGroup {
  name: string;
  items: {
    productId: string;
    name: string;
    price: number;
    description: string;
  }[];
}

/**
 * Внешнее меню для онлайн-заказа (`/api/menu/v3/by_id`, Plain menu converter).
 *
 * Важно: НЕ `/api/2/menu/by_id` — тот падает 500 (баг iiko для этого меню).
 * v3-конвертер отдаёт дерево `itemsGroups[].items[].sizePrices[]`, где и лежат
 * цены; верхний `products[]` — только метаданные. externalMenuId и organizationId
 * — из env (см. config.iiko.externalMenuId / organizationId).
 */
export async function getExternalMenu(): Promise<ExternalMenuGroup[]> {
  const token = await getToken();
  const organizationId = await getOrganizationId();
  const data = await post<{
    itemsGroups?: {
      name: string;
      items?: {
        productId: string;
        name: string;
        description?: string;
        sizePrices?: { price?: number; isDefault?: boolean }[];
      }[];
    }[];
  }>(
    "/api/menu/v3/by_id",
    { externalMenuId: config.iiko.externalMenuId, organizationId },
    token,
  );

  const groups: ExternalMenuGroup[] = [];
  for (const g of data.itemsGroups ?? []) {
    const items = (g.items ?? [])
      .map((it) => {
        // Цена: дефолтный размер, иначе максимальная из размеров.
        const prices = (it.sizePrices ?? [])
          .map((s) => s.price ?? 0)
          .filter((p) => p > 0);
        const def = (it.sizePrices ?? []).find((s) => s.isDefault)?.price ?? 0;
        const price = def > 0 ? def : Math.max(0, ...prices);
        return {
          productId: it.productId,
          name: (it.name ?? "").trim(),
          price,
          description: (it.description ?? "").trim(),
        };
      })
      // Без цены заказать нельзя — такие позиции скрываем.
      .filter((it) => it.productId && it.name && it.price > 0);
    if (items.length) groups.push({ name: g.name, items });
  }
  return groups;
}
