import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { classify } from "./admin/favorites.js";
import { db } from "./admin/db.js";
import { getExternalMenu } from "./iikoClient.js";

/**
 * Меню для дистанционного заказа (панель «огонёк» в mini-app).
 *
 * Источник истины — внешнее меню iiko «Меню для Долины» (getExternalMenu →
 * /api/menu/v3/by_id). Если оно почему-то недоступно — откатываемся на
 * заранее выгруженный файл data/menu-sando.json (устаревший, но лучше пустоты).
 * Контракт ответа общий, фронту всё равно, какой источник. См. menu-source.
 */

export interface OrderMenuItem {
  /** productId iiko — понадобится при создании заказа. */
  id: string;
  name: string;
  price: number;
  category: string;
  kind: "drink" | "food" | "other";
  description?: string;
}
export interface OrderMenuCategory {
  name: string;
  items: OrderMenuItem[];
}
export interface OrderMenu {
  source: "local" | "external" | "empty";
  updatedAt: string;
  categories: OrderMenuCategory[];
}

const menuPath = path.join(path.dirname(config.journalPath), "menu-sando.json");
const TTL_MS = 5 * 60_000;
let cache: { menu: OrderMenu; at: number } | null = null;

/** Меню для заказа (кэш 5 мин). Живое внешнее меню, при сбое — локальный файл. */
export async function getOrderMenu(): Promise<OrderMenu> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.menu;
  const menu = (await loadExternalMenu()) ?? (await loadLocalMenu());
  cache = { menu, at: Date.now() };
  return menu;
}

/** Живое внешнее меню iiko. null — если недоступно (тогда фолбэк на файл). */
async function loadExternalMenu(): Promise<OrderMenu | null> {
  try {
    const groups = await getExternalMenu();
    const categories: OrderMenuCategory[] = groups.map((g) => ({
      name: g.name,
      items: g.items.map((i) => ({
        id: i.productId,
        name: i.name,
        price: i.price,
        category: g.name,
        kind: classify(i.name, g.name),
        description: i.description || undefined,
      })),
    }));
    if (!categories.length) return null;
    return { source: "external", updatedAt: new Date().toISOString(), categories };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[menu] внешнее меню недоступно, фолбэк на файл:", (e as Error).message);
    return null;
  }
}

interface LocalMenuFile {
  fetchedAt?: string;
  categories: {
    name: string;
    items: { id: string; name: string; price: number; description?: string }[];
  }[];
}

async function loadLocalMenu(): Promise<OrderMenu> {
  try {
    const raw = await fs.readFile(menuPath, "utf8");
    const data = JSON.parse(raw) as LocalMenuFile;
    const categories: OrderMenuCategory[] = data.categories
      .map((c) => ({
        name: c.name,
        // Без цены заказать нельзя — такие позиции скрываем.
        items: c.items
          .filter((i) => i.price > 0)
          .map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            category: c.name,
            kind: classify(i.name, c.name),
            description: i.description,
          })),
      }))
      .filter((c) => c.items.length > 0);
    return { source: "local", updatedAt: data.fetchedAt ?? "", categories };
  } catch {
    return { source: "empty", updatedAt: "", categories: [] };
  }
}

export interface FavoriteItem {
  productId: string;
  name: string;
  kind: string;
  orders: number;
}

/**
 * Любимые позиции гостя (из накопленной статистики чеков). Пока вебхук почти
 * не шлёт состав — у большинства гостей список пуст; наполнится по мере данных.
 */
export function favoriteItemsFor(customerId: string): {
  drinks: FavoriteItem[];
  food: FavoriteItem[];
} {
  const rows = db
    .prepare(
      `SELECT productId, name, kind, orders FROM guest_items
       WHERE guestIikoId = ? AND kind IN ('drink','food')
       ORDER BY orders DESC, qty DESC LIMIT 20`,
    )
    .all(customerId) as FavoriteItem[];
  return {
    drinks: rows.filter((r) => r.kind === "drink"),
    food: rows.filter((r) => r.kind === "food"),
  };
}
