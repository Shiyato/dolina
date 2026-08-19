import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// Тест на чистую логику разбора OLAP-строк в «любимое». БД настоящая (SQLite),
// поэтому сеem несколько гостей и проверяем сопоставление + запись позиций.
process.env.ADMIN_DB_PATH = ":memory:";

const { db } = await import("./db.js");
const { ingestFavoritesFromOlap } = await import("./olap-favorites.js");

function seedGuest(iikoId: string, fields: Partial<{ phone: string; name: string; surname: string; cardTrack: string }>) {
  db.prepare(
    "INSERT OR REPLACE INTO guests (iikoId, phone, name, surname, cardTrack, firstSeen, lastSeen) VALUES (?,?,?,?,?,?,?)",
  ).run(
    iikoId,
    fields.phone ?? null,
    fields.name ?? null,
    fields.surname ?? null,
    fields.cardTrack ?? null,
    "2026-01-01",
    "2026-01-01",
  );
}

describe("ingestFavoritesFromOlap", () => {
  before(() => {
    db.prepare("DELETE FROM guests").run();
    db.prepare("DELETE FROM guest_items").run();
    seedGuest("g-id-1", { name: "Иван", surname: "Петров", cardTrack: "CARD777", phone: "+79001112233" });
    seedGuest("g-id-2", { name: "Мария", surname: "Сидорова" });
  });
  after(() => {
    db.prepare("DELETE FROM guests").run();
    db.prepare("DELETE FROM guest_items").run();
  });

  const columns = [
    { field: "GuestCard", name: "Гостевая карта" },
    { field: "DishName", name: "Блюдо" },
    { field: "DishAmountInt", name: "Количество" },
  ];

  it("не про покупки (нет гостя/блюда) → applicable=false", () => {
    const r = ingestFavoritesFromOlap([], [{ field: "PayType", name: "Тип оплаты" }]);
    assert.equal(r.applicable, false);
    assert.equal(r.ingested, 0);
  });

  it("сопоставляет по карте и по имени, пишет любимое", () => {
    const rows = [
      { GuestCard: "CARD777", DishName: "Капучино", DishAmountInt: 5 },
      { GuestCard: "Мария Сидорова", DishName: "Сандо с курицей", DishAmountInt: 3 },
      { GuestCard: "НЕИЗВЕСТНЫЙ", DishName: "Латте", DishAmountInt: 2 },
    ];
    const r = ingestFavoritesFromOlap(rows, columns);
    assert.equal(r.applicable, true);
    assert.equal(r.matchedGuests, 2); // по карте + по имени
    assert.equal(r.unmatched, 1); // «НЕИЗВЕСТНЫЙ»
    // напиток и блюдо записаны, классификация верна
    const drink = db.prepare("SELECT kind FROM guest_items WHERE guestIikoId='g-id-1'").get() as { kind: string };
    assert.equal(drink.kind, "drink");
    const food = db.prepare("SELECT kind FROM guest_items WHERE guestIikoId='g-id-2'").get() as { kind: string };
    assert.equal(food.kind, "food");
  });

  it("идемпотентность: повтор того же отчёта не задваивает qty", () => {
    const rows = [{ GuestCard: "CARD777", DishName: "Капучино", DishAmountInt: 5 }];
    ingestFavoritesFromOlap(rows, columns);
    ingestFavoritesFromOlap(rows, columns);
    const row = db
      .prepare("SELECT qty FROM guest_items WHERE guestIikoId='g-id-1' AND name='Капучино'")
      .get() as { qty: number };
    assert.equal(row.qty, 5); // set-семантика, не 10
  });
});
