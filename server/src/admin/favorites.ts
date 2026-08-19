import { db } from "./db.js";
import { getNomenclature } from "../iikoClient.js";

/**
 * Любимые позиции гостя: что он заказывает чаще всего — отдельно напиток и
 * блюдо. Нужно менеджеру для звонка («Флэт уайт на банановом», «Сандо с курицей»).
 *
 * Источник — позиции закрытого чека (items в вебхуке TableOrderUpdate).
 * В чеке есть только id+name продукта, поэтому категорию (напиток/блюдо)
 * берём из кэша номенклатуры iiko, а при промахе — по названию.
 */

export type ItemKind = "drink" | "food" | "other";

/** Позиция чека, приведённая к нашему виду. */
export interface CheckItem {
  productId: string;
  /** Название с модификаторами: «Флэт уайт на банановом». */
  name: string;
  qty: number;
  kind: ItemKind;
}

// ── Классификация ────────────────────────────────────────────────
const DRINK_RE =
  /кофе|напит|чай|бар|лимонад|смузи|матч|какао|раф|латте|капучин|эспрессо|американо|флэт|флет|мокко|фраппе|коктейл|сок|вода|drink|beverage/i;
const FOOD_RE =
  /кухн|блюд|еда|выпеч|десерт|бенто|сандо|сэндвич|салат|суп|паста|боул|тост|круассан|пирог|торт|чизкейк|завтрак|блин|сырник|каша|омлет|бульон|стейк|бургер|вафл|панкейк|food|bakery|dessert/i;

/** Модификаторы и допы — не самостоятельная позиция, в фавориты не идут. */
const MODIFIER_RE = /^доп|соус|молоко на|добавляем|сироп|топпинг/i;

/** Категория по названию группы/продукта (фолбэк, если нет номенклатуры). */
export function classify(name: string, groupName?: string | null): ItemKind {
  // Допы/соусы/сиропы — это модификаторы, а не любимая позиция.
  if (MODIFIER_RE.test(name) || MODIFIER_RE.test(groupName ?? "")) return "other";
  const hay = `${groupName ?? ""} ${name}`;
  if (DRINK_RE.test(hay)) return "drink";
  if (FOOD_RE.test(hay)) return "food";
  return "other";
}

// ── Кэш номенклатуры ─────────────────────────────────────────────
const upsertNomenclature = db.prepare(`
  INSERT INTO nomenclature (productId, name, groupName, kind, updatedAt)
  VALUES (@productId, @name, @groupName, @kind, @updatedAt)
  ON CONFLICT(productId) DO UPDATE SET
    name=excluded.name, groupName=excluded.groupName,
    kind=excluded.kind, updatedAt=excluded.updatedAt
`);
const selKind = db.prepare(
  "SELECT kind, groupName FROM nomenclature WHERE productId = ?",
);

/** Обновить кэш номенклатуры из iiko. Возвращает число позиций. */
export async function refreshNomenclature(): Promise<number> {
  const products = await getNomenclature();
  const ts = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const p of products) {
      upsertNomenclature.run({
        productId: p.id,
        name: p.name,
        groupName: p.groupName,
        kind: classify(p.name, p.groupName ?? p.categoryName),
        updatedAt: ts,
      });
    }
  });
  tx();
  return products.length;
}

/** Категория продукта: из кэша номенклатуры, иначе — по названию. */
export function kindOf(productId: string, name: string): ItemKind {
  const row = selKind.get(productId) as
    | { kind: string; groupName: string | null }
    | undefined;
  if (row && row.kind !== "other") return row.kind as ItemKind;
  return classify(name, row?.groupName);
}

// ── Накопление позиций гостя ─────────────────────────────────────
const upsertItem = db.prepare(`
  INSERT INTO guest_items (guestIikoId, productId, name, kind, qty, orders, lastSeen)
  VALUES (@guestIikoId, @productId, @name, @kind, @qty, 1, @ts)
  ON CONFLICT(guestIikoId, productId) DO UPDATE SET
    qty      = qty + excluded.qty,
    orders   = orders + 1,
    name     = excluded.name,
    kind     = excluded.kind,
    lastSeen = excluded.lastSeen
`);

/** Записать позиции одного чека в статистику гостя. */
export function recordItems(guestIikoId: string, items: CheckItem[]): void {
  if (!items.length) return;
  const ts = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const it of items) {
      upsertItem.run({
        guestIikoId,
        productId: it.productId,
        name: it.name,
        kind: it.kind,
        qty: it.qty || 1,
        ts,
      });
    }
  });
  tx();
}

// ── Фавориты ─────────────────────────────────────────────────────
const selTop = db.prepare(`
  SELECT name FROM guest_items
  WHERE guestIikoId = ? AND kind = ?
  ORDER BY orders DESC, qty DESC, lastSeen DESC
  LIMIT 1
`);

export interface Favorites {
  drink: string | null;
  food: string | null;
}

/** Любимый напиток и любимое блюдо гостя (самые частые позиции). */
export function favoritesFor(guestIikoId: string): Favorites {
  const drink = selTop.get(guestIikoId, "drink") as { name: string } | undefined;
  const food = selTop.get(guestIikoId, "food") as { name: string } | undefined;
  return { drink: drink?.name ?? null, food: food?.name ?? null };
}

/**
 * Разбор items закрытого чека iiko → CheckItem[].
 * Название дополняем модификаторами («Флэт уайт» + «на банановом»).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCheckItems(items: any): CheckItem[] {
  if (!Array.isArray(items)) return [];
  const out: CheckItem[] = [];
  for (const it of items) {
    // Интересуют только продукты (не услуги/комбо-обёртки) и не удалённые.
    if (it?.deleted) continue;
    const product = it?.product ?? it?.dish ?? null;
    const productId = product?.id ?? it?.productId ?? null;
    const base = product?.name ?? it?.name ?? null;
    if (!productId || !base) continue;

    // Модификаторы уточняют напиток: «на банановом», «без сахара».
    const mods: string[] = Array.isArray(it?.modifiers)
      ? it.modifiers
          .filter((m: any) => !m?.deleted)
          .map((m: any) => m?.product?.name ?? m?.name)
          .filter((s: unknown): s is string => typeof s === "string" && !!s)
      : [];
    const name = mods.length ? `${base} ${mods.join(", ")}` : base;

    out.push({
      productId: String(productId),
      name,
      qty: Number(it?.amount ?? 1) || 1,
      kind: kindOf(String(productId), name),
    });
  }
  return out;
}
