import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db.js";
import { login, requireAuth, PRIVILEGED, type AdminUser } from "./auth.js";
import {
  addWeeks,
  currentWeekStart,
  isoWeekNumber,
  segmentLabel,
} from "./weeks.js";
import { analyticsXlsx, leadsXlsx, tasksXlsx } from "./export.js";
import { rebuildWeek } from "./aggregate.js";
import { backfillMany, refreshRecent } from "./backfill.js";
import { refreshNomenclature } from "./favorites.js";
import { importJournal } from "./journal-import.js";
import {
  isRestoConfigured,
  olapColumns,
  runOlap,
  RestoError,
} from "../iikoServer.js";
import { ingestFavoritesFromOlap } from "./olap-favorites.js";

/**
 * API админ-панели под /api/admin/*. Все, кроме /login, требуют Bearer-токен.
 */
export const adminRouter = Router();

type Req = Request & { adminUser?: AdminUser };

function h(fn: (req: Req, res: import("express").Response) => void) {
  return (req: Req, res: import("express").Response) => {
    try {
      fn(req, res);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[admin]", e);
      res.status(500).json({ error: "internal" });
    }
  };
}

/** Логин. */
adminRouter.post("/login", (req, res) => {
  const { login: l, password } = req.body ?? {};
  if (!l || !password) {
    res.status(400).json({ error: "bad_request" });
    return;
  }
  const r = login(String(l), String(password));
  if (!r) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  res.json(r);
});

// Дальше — только авторизованные.
adminRouter.use(requireAuth);

/** Текущий пользователь. */
adminRouter.get("/me", (req: Req, res) => res.json({ user: req.adminUser }));

/**
 * Список недель для скролл-бара. Отдаём окно вокруг текущей недели:
 * несколько прошлых + текущая + несколько будущих. Флаг hasData — есть ли
 * снимок (влияет на контраст в UI). confirmed — статус 100%.
 */
adminRouter.get(
  "/weeks",
  h((_req, res) => {
    const cur = currentWeekStart();
    const past = Number(_req.query.past ?? 12);
    const future = Number(_req.query.future ?? 4);
    const withData = new Set(
      (db
        .prepare(
          "SELECT DISTINCT weekStart FROM week_segment WHERE checks > 0",
        )
        .all() as { weekStart: string }[]).map((r) => r.weekStart),
    );
    const confirmed = new Map(
      (db.prepare("SELECT weekStart, confirmed FROM week_status").all() as {
        weekStart: string;
        confirmed: number;
      }[]).map((r) => [r.weekStart, !!r.confirmed]),
    );
    const weeks = [];
    for (let i = -past; i <= future; i++) {
      const ws = addWeeks(cur, i);
      weeks.push({
        weekStart: ws,
        weekNumber: isoWeekNumber(ws),
        isCurrent: i === 0,
        isFuture: i > 0,
        hasData: withData.has(ws),
        confirmed: confirmed.get(ws) ?? false,
      });
    }
    res.json({ current: cur, weeks });
  }),
);

/** Аналитика за неделю: таблица сегментов + серии для графиков (6 недель). */
adminRouter.get(
  "/analytics",
  h((req, res) => {
    const week = String(req.query.week ?? currentWeekStart());
    const prev = addWeeks(week, -1);

    const segRow = (ws: string, seg: string) =>
      (db
        .prepare(
          "SELECT guests, checks, sum FROM week_segment WHERE weekStart=? AND segment=?",
        )
        .get(ws, seg) as { guests: number; checks: number; sum: number } | undefined) ?? {
        guests: 0,
        checks: 0,
        sum: 0,
      };

    const segments = ["7", "6", "5", "4", "3", "2", "1", "total"].map((seg) => {
      const c = segRow(week, seg);
      const p = segRow(prev, seg);
      const pct = (cur: number, prv: number) =>
        prv === 0 ? (cur === 0 ? 0 : 100) : Math.round(((cur - prv) / prv) * 100);
      return {
        segment: seg === "total" ? "total" : segmentLabel(seg),
        prevGuests: p.guests,
        prevChecks: p.checks,
        prevSum: Math.round(p.sum),
        curGuests: c.guests,
        curChecks: c.checks,
        curSum: Math.round(c.sum),
        dGuests: c.guests - p.guests,
        dGuestsPct: pct(c.guests, p.guests),
        dChecks: c.checks - p.checks,
        dChecksPct: pct(c.checks, p.checks),
        dSum: Math.round(c.sum - p.sum),
        dSumPct: pct(c.sum, p.sum),
      };
    });

    // Серии графиков: 6 недель (5 прошлых + выбранная), по каждому сегменту 1..7
    // три метрики: guests, checks, avg (средний чек = sum/checks).
    const weeksBack = [5, 4, 3, 2, 1, 0].map((n) => addWeeks(week, -n));
    const charts = [7, 6, 5, 4, 3, 2, 1].map((seg) => {
      const series = weeksBack.map((ws) => {
        const r = segRow(ws, String(seg));
        return {
          weekStart: ws,
          weekNumber: isoWeekNumber(ws),
          guests: r.guests,
          checks: r.checks,
          revenue: Math.round(r.sum),
          avg: r.checks > 0 ? Math.round(r.sum / r.checks) : 0,
        };
      });
      return { segment: segmentLabel(seg), series };
    });

    res.json({ week, segments, charts });
  }),
);

/** Задачи недели, сгруппированы по когортам. */
adminRouter.get(
  "/tasks",
  h((req, res) => {
    const week = String(req.query.week ?? currentWeekStart());
    const rows = db
      .prepare("SELECT * FROM tasks WHERE weekStart = ? ORDER BY cohort, id")
      .all(week) as TaskRow[];
    const status = db
      .prepare("SELECT * FROM week_status WHERE weekStart = ?")
      .get(week) as WeekStatusRow | undefined;

    const group = (cohort: string) => rows.filter((r) => r.cohort === cohort);
    const allDone = rows.length > 0 && rows.every((r) => r.done);

    res.json({
      week,
      isCurrentWeek: week === currentWeekStart() || week === addWeeks(currentWeekStart(), -1),
      cohorts: {
        "5plus": group("5plus"),
        "2-4": group("2-4"),
        "1": group("1"),
      },
      total: rows.length,
      doneCount: rows.filter((r) => r.done).length,
      canConfirm: allDone && !status?.confirmed,
      confirmed: !!status?.confirmed,
      confirmedByName: status?.confirmedByName ?? null,
      confirmedAt: status?.confirmedAt ?? null,
    });
  }),
);

/** Отметить/снять выполнение задачи (только неделя, доступная для правки). */
adminRouter.post(
  "/tasks/:id/done",
  h((req: Req, res) => {
    const id = Number(req.params.id);
    const done = req.body?.done !== false;
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    if (!task) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!isEditableWeek(task.weekStart)) {
      res.status(403).json({ error: "week_frozen" });
      return;
    }
    const status = db
      .prepare("SELECT confirmed FROM week_status WHERE weekStart = ?")
      .get(task.weekStart) as { confirmed: number } | undefined;
    if (status?.confirmed) {
      res.status(403).json({ error: "week_confirmed" });
      return;
    }
    const u = req.adminUser!;
    db.prepare(
      "UPDATE tasks SET done=?, doneByUserId=?, doneByName=?, doneAt=? WHERE id=?",
    ).run(
      done ? 1 : 0,
      done ? u.id : null,
      done ? `${u.name} ${u.surname}`.trim() : null,
      done ? new Date().toISOString() : null,
      id,
    );
    res.json({ ok: true });
  }),
);

/** Подтвердить неделю → статус 100% (только если все задачи выполнены). */
adminRouter.post(
  "/weeks/:week/confirm",
  h((req: Req, res) => {
    const week = req.params.week;
    if (!isEditableWeek(week)) {
      res.status(403).json({ error: "week_frozen" });
      return;
    }
    const rows = db.prepare("SELECT done FROM tasks WHERE weekStart = ?").all(week) as {
      done: number;
    }[];
    if (rows.length === 0 || !rows.every((r) => r.done)) {
      res.status(400).json({ error: "not_all_done" });
      return;
    }
    const u = req.adminUser!;
    db.prepare(`
      INSERT INTO week_status (weekStart, confirmed, confirmedByUserId, confirmedByName, confirmedAt)
      VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(weekStart) DO UPDATE SET
        confirmed=1, confirmedByUserId=excluded.confirmedByUserId,
        confirmedByName=excluded.confirmedByName, confirmedAt=excluded.confirmedAt
    `).run(week, u.id, `${u.name} ${u.surname}`.trim(), new Date().toISOString());
    res.json({ ok: true });
  }),
);

/** Создать пользователя панели (только admin). */
adminRouter.post("/users", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const { login: l, password, name, surname, role } = req.body ?? {};
  if (!l || !password) {
    res.status(400).json({ error: "login_and_password_required" });
    return;
  }
  const r = ["owner","admin","manager"].includes(role) ? (role as "owner"|"admin"|"manager") : "manager";
  try {
    const hash = bcrypt.hashSync(String(password), 10);
    const info = db
      .prepare(
        "INSERT INTO users (login, passwordHash, name, surname, role, createdAt) VALUES (?,?,?,?,?,?)",
      )
      .run(String(l), hash, String(name ?? ""), String(surname ?? ""), r, new Date().toISOString());
    res.json({ ok: true, id: info.lastInsertRowid, login: l, role: r });
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      res.status(409).json({ error: "login_taken" });
      return;
    }
    throw e;
  }
});

/**
 * Бэкфилл истории по списку телефонов гостей (admin).
 * body: { phones: string[], days?: number } — телефоны из экспорта iikoWeb.
 * Тянет транзакции каждого гостя из iiko (CloseOrder=чеки) и пересчитывает недели.
 */
adminRouter.post("/backfill", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const phones: string[] = Array.isArray(req.body?.phones)
    ? req.body.phones.map(String).filter(Boolean)
    : [];
  if (!phones.length) {
    res.status(400).json({ error: "phones_required" });
    return;
  }
  const days = Math.min(Number(req.body?.days ?? 365) || 365, 365);
  backfillMany(phones, days)
    .then((r) => res.json(r))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[backfill]", e);
      res.status(500).json({ error: "backfill_failed" });
    });
});

/** Ручное плановое обновление (admin): пул чеков всех гостей за N дней + пересчёт. */
adminRouter.post("/refresh", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const days = Math.min(Number(req.body?.days ?? 14) || 14, 365);
  refreshRecent(days)
    .then((r) => res.json({ ok: true, ...r }))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[refresh]", e);
      res.status(500).json({ error: "refresh_failed" });
    });
});

/** Ручной пересчёт недели (admin). ?week= (по умолчанию текущая) + прошлая. */
adminRouter.post("/rebuild", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const week = String((req.body?.week as string) ?? currentWeekStart());
  rebuildWeek(addWeeks(week, -1));
  rebuildWeek(week);
  res.json({ ok: true, rebuilt: [addWeeks(week, -1), week] });
});

/**
 * Импорт «Журнала операций» из iikoWeb (исторические чеки).
 * body: { orders: [{date, phone, sum}], guests: [{phone, name}] }
 * Резолв телефонов долгий — работаем в фоне, прогресс в логах контейнера.
 */
adminRouter.post(
  "/import-journal",
  h((req: Req, res) => {
    if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    const guests = Array.isArray(req.body?.guests) ? req.body.guests : [];
    if (!orders.length) {
      res.status(400).json({ error: "orders_required" });
      return;
    }
    const r = importJournal({ orders, guests });
    // eslint-disable-next-line no-console
    console.log("[journal] импорт:", JSON.stringify(r));
    res.json({ ok: true, ...r });
  }),
);

/** Обновить кэш номенклатуры iiko (нужен для «напиток/блюдо»). */
adminRouter.post("/nomenclature/refresh", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  refreshNomenclature()
    .then((count) => res.json({ ok: true, products: count }))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[nomenclature]", e);
      res.status(500).json({ error: "nomenclature_failed" });
    });
});

/** Отчёт по выполнению задач за неделю: % по когортам + обделённые. */
adminRouter.get(
  "/report",
  h((req, res) => {
    const week = String(req.query.week ?? currentWeekStart());
    const rows = db
      .prepare("SELECT * FROM tasks WHERE weekStart = ?")
      .all(week) as TaskRow[];
    const byCohort = (c: string) => {
      const list = rows.filter((r) => r.cohort === c);
      const done = list.filter((r) => r.done).length;
      return {
        total: list.length,
        done,
        percent: list.length ? Math.round((done / list.length) * 100) : 0,
      };
    };
    const neglected = rows
      .filter((r) => !r.done && r.guestIikoId)
      .map((r) => ({ name: r.guestName, phone: r.guestPhone, reason: r.reason }));
    res.json({
      week,
      cohorts: { "5plus": byCohort("5plus"), "2-4": byCohort("2-4"), "1": byCohort("1") },
      neglected,
    });
  }),
);

/** Экспорт аналитики в .xlsx. */
adminRouter.get("/export/analytics.xlsx", (req, res) => {
  const week = String(req.query.week ?? currentWeekStart());
  analyticsXlsx(week)
    .then((buf) => {
      res
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .set("Content-Disposition", `attachment; filename="analytics-w${isoWeekNumber(week)}.xlsx"`)
        .send(buf);
    })
    .catch(() => res.status(500).json({ error: "export_failed" }));
});

/** Экспорт задач в .xlsx. */
adminRouter.get("/export/tasks.xlsx", (req, res) => {
  const week = String(req.query.week ?? currentWeekStart());
  tasksXlsx(week)
    .then((buf) => {
      res
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .set("Content-Disposition", `attachment; filename="tasks-w${isoWeekNumber(week)}.xlsx"`)
        .send(buf);
    })
    .catch(() => res.status(500).json({ error: "export_failed" }));
});

/** Экспорт гостей сегмента «1 визит» с телефонами (для SMS) в .xlsx. */
adminRouter.get("/export/leads.xlsx", (req, res) => {
  const week = String(req.query.week ?? currentWeekStart());
  leadsXlsx(week)
    .then((buf) => {
      res
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .set("Content-Disposition", `attachment; filename="leads-w${isoWeekNumber(week)}.xlsx"`)
        .send(buf);
    })
    .catch(() => res.status(500).json({ error: "export_failed" }));
});

/** Ручные показатели сегмента «1 визит» за неделю (блогеры/просмотры, план-факт). */
adminRouter.get(
  "/segment1",
  h((req, res) => {
    const week = String(req.query.week ?? currentWeekStart());
    const row = db
      .prepare("SELECT * FROM week_segment1 WHERE weekStart = ?")
      .get(week) as Segment1Row | undefined;
    res.json({
      week,
      bloggersPlan: row?.bloggersPlan ?? 0,
      bloggersFact: row?.bloggersFact ?? 0,
      viewsPlan: row?.viewsPlan ?? 0,
      viewsFact: row?.viewsFact ?? 0,
      updatedByName: row?.updatedByName ?? null,
      updatedAt: row?.updatedAt ?? null,
    });
  }),
);

/** Сохранить показатели сегмента «1 визит» (только редактируемая неделя). */
adminRouter.post(
  "/segment1",
  h((req: Req, res) => {
    const week = String(req.body?.week ?? currentWeekStart());
    if (!isEditableWeek(week)) {
      res.status(403).json({ error: "week_frozen" });
      return;
    }
    const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
    const u = req.adminUser!;
    db.prepare(`
      INSERT INTO week_segment1 (weekStart, bloggersPlan, bloggersFact, viewsPlan, viewsFact, updatedByName, updatedAt)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(weekStart) DO UPDATE SET
        bloggersPlan=excluded.bloggersPlan, bloggersFact=excluded.bloggersFact,
        viewsPlan=excluded.viewsPlan, viewsFact=excluded.viewsFact,
        updatedByName=excluded.updatedByName, updatedAt=excluded.updatedAt
    `).run(
      week,
      n(req.body?.bloggersPlan),
      n(req.body?.bloggersFact),
      n(req.body?.viewsPlan),
      n(req.body?.viewsFact),
      `${u.name} ${u.surname}`.trim(),
      new Date().toISOString(),
    );
    res.json({ ok: true });
  }),
);

// ── OLAP-отчёты (iikoServer) ─────────────────────────────────────

type ReportType = "SALES" | "TRANSACTIONS" | "DELIVERIES";
const REPORT_TYPES: ReportType[] = ["SALES", "TRANSACTIONS", "DELIVERIES"];

/** Настроен ли доступ к iikoServer (страница отчётов рисует по этому флагу). */
adminRouter.get("/olap/status", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({ configured: isRestoConfigured() });
});

/** Список доступных полей отчёта (для конструктора). */
adminRouter.get("/olap/columns", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!isRestoConfigured()) {
    res.status(503).json({ error: "resto_not_configured" });
    return;
  }
  const rt = String(req.query.reportType ?? "SALES") as ReportType;
  const reportType = REPORT_TYPES.includes(rt) ? rt : "SALES";
  olapColumns(reportType)
    .then((columns) => res.json({ columns }))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[olap/columns]", e);
      const status = e instanceof RestoError ? 502 : 500;
      res.status(status).json({ error: "olap_failed", message: (e as Error).message });
    });
});

/** Выполнить OLAP-отчёт. body: {reportType, groupByRowFields, aggregateFields, from, to}. */
adminRouter.post("/olap/report", (req: Req, res) => {
  if (!req.adminUser || !PRIVILEGED.includes(req.adminUser.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!isRestoConfigured()) {
    res.status(503).json({ error: "resto_not_configured" });
    return;
  }
  const b = req.body ?? {};
  const rt = String(b.reportType ?? "SALES") as ReportType;
  const reportType = REPORT_TYPES.includes(rt) ? rt : "SALES";
  const groupByRowFields = Array.isArray(b.groupByRowFields)
    ? b.groupByRowFields.map(String)
    : [];
  const aggregateFields = Array.isArray(b.aggregateFields)
    ? b.aggregateFields.map(String)
    : [];
  const from = String(b.from ?? "");
  const to = String(b.to ?? "");
  if (!groupByRowFields.length || !aggregateFields.length || !from || !to) {
    res.status(400).json({ error: "bad_request" });
    return;
  }
  const fieldCols = [...groupByRowFields, ...aggregateFields];
  runOlap({ reportType, groupByRowFields, aggregateFields, from, to })
    .then((data) => {
      // Авто-формирование «любимого»: если в отчёте есть гость+блюдо, раскладываем
      // строки в guest_items (для панели 🔥 и задач). Не про покупки — пропустится.
      let favorites: ReturnType<typeof ingestFavoritesFromOlap> | undefined;
      if (reportType === "SALES") {
        try {
          favorites = ingestFavoritesFromOlap(
            data,
            fieldCols.map((f) => ({ field: f, name: f })),
          );
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[olap/report] ingest favorites", e);
        }
      }
      res.json({ rows: data, columns: fieldCols, favorites });
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[olap/report]", e);
      const status = e instanceof RestoError ? 502 : 500;
      res.status(status).json({ error: "olap_failed", message: (e as Error).message });
    });
});

/** Неделя редактируема, если это текущая или прошлая (на основе прошлых данных). */
function isEditableWeek(week: string): boolean {
  const cur = currentWeekStart();
  return week === cur || week === addWeeks(cur, -1);
}

interface TaskRow {
  id: number;
  weekStart: string;
  cohort: string;
  guestIikoId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  reason: string;
  done: number;
  doneByName: string | null;
  doneAt: string | null;
  cashbackCategory: string | null;
}
interface WeekStatusRow {
  weekStart: string;
  confirmed: number;
  confirmedByName: string | null;
  confirmedAt: string | null;
}
interface Segment1Row {
  weekStart: string;
  bloggersPlan: number;
  bloggersFact: number;
  viewsPlan: number;
  viewsFact: number;
  updatedByName: string | null;
  updatedAt: string | null;
}
