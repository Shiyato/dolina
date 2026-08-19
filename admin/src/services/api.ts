/**
 * HTTP-клиент к /api/admin. Same-origin в проде; для dev против прода —
 * VITE_API_BASE=https://dolina-coffee.ru. Токен — в localStorage.
 */

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "dolina.admin.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/admin${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

// ── Типы ─────────────────────────────────────────────────────────
export interface AdminUser {
  id: number;
  login: string;
  name: string;
  surname: string;
  role: "owner" | "admin" | "manager";
}

export interface WeekInfo {
  weekStart: string;
  weekNumber: number;
  isCurrent: boolean;
  isFuture: boolean;
  hasData: boolean;
  confirmed: boolean;
}

export interface Task {
  id: number;
  cohort: "5plus" | "2-4" | "1";
  guestName: string | null;
  guestPhone: string | null;
  reason: string;
  done: number;
  doneByName: string | null;
  /** Любимый напиток гостя — контекст для звонка. */
  favoriteDrink: string | null;
  /** Любимое блюдо гостя. */
  favoriteFood: string | null;
  /** Категория лояльности из iiko: «Cashback 10%» / «VIP Cashback 15%». */
  cashbackCategory: string | null;
}

export interface TasksResponse {
  week: string;
  isCurrentWeek: boolean;
  cohorts: { "5plus": Task[]; "2-4": Task[]; "1": Task[] };
  total: number;
  doneCount: number;
  canConfirm: boolean;
  confirmed: boolean;
  confirmedByName: string | null;
}

export interface SegmentRow {
  segment: string;
  prevGuests: number;
  prevChecks: number;
  prevSum: number;
  curGuests: number;
  curChecks: number;
  curSum: number;
  dGuests: number;
  dGuestsPct: number;
  dChecks: number;
  dChecksPct: number;
  dSum: number;
  dSumPct: number;
}

export interface ChartPoint {
  weekStart: string;
  weekNumber: number;
  guests: number;
  checks: number;
  revenue: number;
  avg: number;
}

export interface AnalyticsResponse {
  week: string;
  segments: SegmentRow[];
  charts: { segment: string; series: ChartPoint[] }[];
}

// ── Методы ───────────────────────────────────────────────────────
export async function login(loginName: string, password: string) {
  const r = await request<{ token: string; user: AdminUser }>("/login", {
    method: "POST",
    body: JSON.stringify({ login: loginName, password }),
  });
  setToken(r.token);
  return r.user;
}

export const me = () => request<{ user: AdminUser }>("/me");
export const fetchWeeks = () =>
  request<{ current: string; weeks: WeekInfo[] }>("/weeks?past=12&future=4");
export const fetchTasks = (week: string) =>
  request<TasksResponse>(`/tasks?week=${week}`);
export const setTaskDone = (id: number, done: boolean) =>
  request<{ ok: true }>(`/tasks/${id}/done`, {
    method: "POST",
    body: JSON.stringify({ done }),
  });
export const confirmWeek = (week: string) =>
  request<{ ok: true }>(`/weeks/${week}/confirm`, { method: "POST", body: "{}" });
export const fetchAnalytics = (week: string) =>
  request<AnalyticsResponse>(`/analytics?week=${week}`);

// ── OLAP-отчёты (iikoServer) ─────────────────────────────────────
export type ReportType = "SALES" | "TRANSACTIONS" | "DELIVERIES";
export interface OlapColumn {
  field: string;
  name: string;
  type: string;
  aggregationAllowed: boolean;
  groupingAllowed: boolean;
  filteringAllowed: boolean;
  tags: string[];
}
export interface FavoritesIngest {
  applicable: boolean;
  matchedGuests: number;
  unmatched: number;
  ingested: number;
}
export interface OlapReport {
  rows: Record<string, string | number>[];
  columns: string[];
  /** Итог авто-наполнения «любимого» из этого отчёта (если это продажи). */
  favorites?: FavoritesIngest;
}
export const fetchOlapStatus = () =>
  request<{ configured: boolean }>("/olap/status");
export const fetchOlapColumns = (reportType: ReportType) =>
  request<{ columns: OlapColumn[] }>(`/olap/columns?reportType=${reportType}`);
export const runOlapReport = (body: {
  reportType: ReportType;
  groupByRowFields: string[];
  aggregateFields: string[];
  from: string;
  to: string;
}) =>
  request<OlapReport>("/olap/report", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Сегмент «1 визит»: ручные показатели блогеров/просмотров ─────
export interface SegmentOne {
  week: string;
  bloggersPlan: number;
  bloggersFact: number;
  viewsPlan: number;
  viewsFact: number;
  updatedByName: string | null;
  updatedAt: string | null;
}
export const fetchSegmentOne = (week: string) =>
  request<SegmentOne>(`/segment1?week=${week}`);
export const saveSegmentOne = (
  week: string,
  v: Pick<SegmentOne, "bloggersPlan" | "bloggersFact" | "viewsPlan" | "viewsFact">,
) =>
  request<{ ok: true }>("/segment1", {
    method: "POST",
    body: JSON.stringify({ week, ...v }),
  });

/** URL для скачивания xlsx (с токеном не выйдет через href — качаем блобом). */
export async function downloadXlsx(
  kind: "analytics" | "tasks" | "leads",
  week: string,
) {
  const res = await fetch(
    `${API_BASE}/api/admin/export/${kind}.xlsx?week=${week}`,
    { headers: { Authorization: `Bearer ${getToken()}` } },
  );
  if (!res.ok) throw new ApiError("export_failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kind}-${week}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
