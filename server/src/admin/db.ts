import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

/**
 * БД админ-панели (SQLite через better-sqlite3). Файл на том же volume, что и
 * журнал (config.journalPath directory). Схема создаётся идемпотентно.
 */

const dbPath =
  process.env.ADMIN_DB_PATH ??
  path.join(path.dirname(config.journalPath), "admin.sqlite");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  login        TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  surname      TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'manager',   -- admin | manager
  createdAt    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guests (
  iikoId    TEXT PRIMARY KEY,
  phone     TEXT,
  name      TEXT,
  surname   TEXT,
  firstSeen TEXT,
  lastSeen  TEXT
);

-- Сырьё сбора: агрегат по гостю за день (наполняется вебхуками закрытия чека).
CREATE TABLE IF NOT EXISTS orders_daily (
  date         TEXT NOT NULL,          -- YYYY-MM-DD (локальная дата чека)
  guestIikoId  TEXT NOT NULL,
  ordersCount  INTEGER NOT NULL DEFAULT 0,
  ordersSum    REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (date, guestIikoId)
);

-- Дедуп обработанных чеков (idempotency по orderId).
CREATE TABLE IF NOT EXISTS processed_orders (
  orderId   TEXT PRIMARY KEY,
  whenSeen  TEXT NOT NULL
);

-- Снимок метрик гостя за календарную неделю (ISO, weekStart = понедельник).
CREATE TABLE IF NOT EXISTS week_guest (
  weekStart    TEXT NOT NULL,
  guestIikoId  TEXT NOT NULL,
  visits30d    INTEGER NOT NULL DEFAULT 0,
  ordersCount  INTEGER NOT NULL DEFAULT 0,
  ordersSum    REAL NOT NULL DEFAULT 0,
  segment      INTEGER NOT NULL,       -- 1..7 (7 = «7+»)
  PRIMARY KEY (weekStart, guestIikoId)
);

-- Агрегат аналитики по сегменту за неделю (для экрана 2 и графиков).
CREATE TABLE IF NOT EXISTS week_segment (
  weekStart TEXT NOT NULL,
  segment   TEXT NOT NULL,             -- '1'..'7' | 'total'
  guests    INTEGER NOT NULL DEFAULT 0,
  checks    INTEGER NOT NULL DEFAULT 0,
  sum       REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (weekStart, segment)
);

-- Задачи менеджеру за неделю.
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  weekStart    TEXT NOT NULL,
  cohort       TEXT NOT NULL,          -- '5plus' | '2-4' | '1'
  guestIikoId  TEXT,                   -- NULL для когорты «1»
  guestName    TEXT,
  guestPhone   TEXT,
  reason       TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  doneByUserId INTEGER,
  doneByName   TEXT,
  doneAt       TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_week ON tasks(weekStart);

-- Позиции чеков по гостю: сколько раз заказывал каждое блюдо/напиток.
-- Наполняется из items закрытого чека (вебхук TableOrderUpdate).
CREATE TABLE IF NOT EXISTS guest_items (
  guestIikoId TEXT NOT NULL,
  productId   TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'other',  -- 'drink' | 'food' | 'other'
  qty         REAL NOT NULL DEFAULT 0,        -- суммарное количество
  orders      INTEGER NOT NULL DEFAULT 0,     -- в скольких чеках встречалось
  lastSeen    TEXT,
  PRIMARY KEY (guestIikoId, productId)
);
CREATE INDEX IF NOT EXISTS idx_guest_items_guest ON guest_items(guestIikoId);

-- Кэш номенклатуры iiko: продукт → группа → категория (напиток/блюдо).
CREATE TABLE IF NOT EXISTS nomenclature (
  productId TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  groupName TEXT,
  kind      TEXT NOT NULL DEFAULT 'other',
  updatedAt TEXT
);

-- Состояние лояльности гостя для mini-app: когда стал претендентом на ПРО,
-- показывали ли ему уведомление, и когда получил ПРО (статус перманентный).
CREATE TABLE IF NOT EXISTS guest_loyalty (
  customerId          TEXT PRIMARY KEY,   -- iiko customer id
  contenderSince      TEXT,               -- ISO: когда набрал 7 визитов
  contenderNotifiedAt TEXT,               -- ISO: когда показали модал
  proSince            TEXT                -- ISO: когда получил ПРО (навсегда)
);

-- Статус недели: подтверждена ли (100%).
CREATE TABLE IF NOT EXISTS week_status (
  weekStart     TEXT PRIMARY KEY,
  confirmed     INTEGER NOT NULL DEFAULT 0,
  confirmedByUserId INTEGER,
  confirmedByName   TEXT,
  confirmedAt   TEXT
);

-- Ручные показатели по сегменту «1 визит» за неделю: блогеры и просмотры,
-- план и факт (вводит менеджер). Заменяет авто-задачу когорты «1».
CREATE TABLE IF NOT EXISTS week_segment1 (
  weekStart     TEXT PRIMARY KEY,
  bloggersPlan  INTEGER NOT NULL DEFAULT 0,
  bloggersFact  INTEGER NOT NULL DEFAULT 0,
  viewsPlan     INTEGER NOT NULL DEFAULT 0,
  viewsFact     INTEGER NOT NULL DEFAULT 0,
  updatedByName TEXT,
  updatedAt     TEXT
);
`);

/** Идемпотентно добавить колонку (SQLite не умеет ADD COLUMN IF NOT EXISTS). */
function addColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// Любимые позиции гостя — снимок на момент генерации задачи.
addColumn("tasks", "favoriteDrink", "TEXT");
addColumn("tasks", "favoriteFood", "TEXT");

// Категория лояльности гостя из iiko (напр. «VIP Cashback 15%»).
addColumn("guests", "category", "TEXT");
// Снимок категории лояльности на момент генерации задачи.
addColumn("tasks", "cashbackCategory", "TEXT");
// Номер/трек карты гостя — ключ сопоставления с гостем в OLAP-отчёте.
addColumn("guests", "cardTrack", "TEXT");
