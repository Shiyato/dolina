import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * Клиент iikoServer API (НЕ облачный iikoCloud) для OLAP-отчётов.
 *
 * Живёт по адресу ресторанного сервера: https://host:port/resto/api/...
 * Авторизация отдельная: GET /resto/api/auth?login=&pass=sha1(пароль) → key
 * (строка-токен, занимает лицензию), в конце обязательно /resto/api/logout.
 * Поэтому каждый отчёт оборачиваем в withSession: auth → работа → logout.
 *
 * Доступы — только в server-env, никогда на клиенте:
 *   IIKO_RESTO_HOST       — база, напр. https://xxx.iiko.it:443
 *   IIKO_RESTO_LOGIN      — отдельный пользователь офиса с правом на отчёты
 *   IIKO_RESTO_PASS       — его пароль (или IIKO_RESTO_PASS_SHA1 — готовый sha1)
 */

const REQUEST_TIMEOUT_MS = 60_000; // OLAP бывает медленным

/** Настроен ли доступ к iikoServer (иначе страница отчётов покажет заглушку). */
export function isRestoConfigured(): boolean {
  return Boolean(
    config.resto.host && config.resto.login && (config.resto.pass || config.resto.passSha1),
  );
}

function passHash(): string {
  if (config.resto.passSha1) return config.resto.passSha1;
  return crypto.createHash("sha1").update(config.resto.pass).digest("hex");
}

export class RestoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Логин → key (токен-лицензия). */
async function auth(): Promise<string> {
  const url =
    `${config.resto.host}/resto/api/auth` +
    `?login=${encodeURIComponent(config.resto.login)}&pass=${passHash()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = (await res.text()).trim();
  if (!res.ok || !text || /[<{]/.test(text[0])) {
    throw new RestoError(`resto auth failed: ${res.status} ${text.slice(0, 120)}`, res.status);
  }
  return text; // key — простая строка
}

/** Освободить лицензию (важно: слотов мало). Ошибки глушим. */
async function logout(key: string): Promise<void> {
  try {
    await fetch(`${config.resto.host}/resto/api/logout?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* лицензия сама протухнет */
  }
}

/** Выполнить работу в рамках одной сессии (auth → fn → logout). */
async function withSession<T>(fn: (key: string) => Promise<T>): Promise<T> {
  const key = await auth();
  try {
    return await fn(key);
  } finally {
    await logout(key);
  }
}

export interface OlapColumn {
  field: string; // FieldName — используется в запросе
  name: string; // человекочитаемое имя (как в iikoOffice)
  type: string;
  aggregationAllowed: boolean;
  groupingAllowed: boolean;
  filteringAllowed: boolean;
  tags: string[];
}

/** Список доступных полей отчёта (для конструктора на странице отчётов). */
export async function olapColumns(
  reportType: "SALES" | "TRANSACTIONS" | "DELIVERIES",
): Promise<OlapColumn[]> {
  return withSession(async (key) => {
    const url = `${config.resto.host}/resto/api/v2/reports/olap/columns?key=${encodeURIComponent(
      key,
    )}&reportType=${reportType}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await res.text();
    if (!res.ok) throw new RestoError(`olap/columns ${res.status}: ${text.slice(0, 160)}`, res.status);
    const raw = JSON.parse(text) as Record<
      string,
      {
        name: string;
        type: string;
        aggregationAllowed: boolean;
        groupingAllowed: boolean;
        filteringAllowed: boolean;
        tags?: string[];
      }
    >;
    return Object.entries(raw).map(([field, v]) => ({
      field,
      name: v.name,
      type: v.type,
      aggregationAllowed: v.aggregationAllowed,
      groupingAllowed: v.groupingAllowed,
      filteringAllowed: v.filteringAllowed,
      tags: v.tags ?? [],
    }));
  });
}

export interface OlapRequest {
  reportType: "SALES" | "TRANSACTIONS" | "DELIVERIES";
  groupByRowFields: string[];
  aggregateFields: string[];
  /** Даты YYYY-MM-DD (включительно). */
  from: string;
  to: string;
}

/** Поле фильтра по дате зависит от типа отчёта (см. доку OLAP v2). */
function dateField(reportType: OlapRequest["reportType"]): string {
  return reportType === "TRANSACTIONS" ? "DateTime.Typed" : "OpenDate.Typed";
}

/** Выполнить OLAP-отчёт. Возвращает построчные данные (data). */
export async function runOlap(req: OlapRequest): Promise<Record<string, unknown>[]> {
  return withSession(async (key) => {
    const body = {
      reportType: req.reportType,
      buildSummary: false,
      groupByRowFields: req.groupByRowFields,
      groupByColFields: [],
      aggregateFields: req.aggregateFields,
      filters: {
        [dateField(req.reportType)]: {
          filterType: "DateRange",
          periodType: "CUSTOM",
          from: `${req.from}T00:00:00.000`,
          to: `${req.to}T00:00:00.000`,
          includeLow: true,
          includeHigh: true,
        },
      },
    };
    const url = `${config.resto.host}/resto/api/v2/reports/olap?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new RestoError(`olap ${res.status}: ${text.slice(0, 200)}`, res.status);
    const parsed = JSON.parse(text) as { data?: Record<string, unknown>[] };
    return parsed.data ?? [];
  });
}
