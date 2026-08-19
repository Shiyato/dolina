import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetween,
  findCandidates,
  median,
  riskReason,
  windowBounds,
} from "./cadence.js";

/** Ряд дат: `n` визитов с шагом `gap` дней, последний = `last`. */
function series(last: string, gap: number, n: number): string[] {
  const out: string[] = [];
  const base = Date.parse(last + "T00:00:00Z");
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * gap * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

describe("median", () => {
  it("нечётная длина — средний", () => {
    assert.equal(median([3, 1, 2]), 2);
  });
  it("чётная длина — среднее двух центральных", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
});

describe("daysBetween", () => {
  it("разница в днях b − a", () => {
    assert.equal(daysBetween("2026-07-01", "2026-07-27"), 26);
    assert.equal(daysBetween("2026-07-27", "2026-07-27"), 0);
  });
});

describe("windowBounds", () => {
  it("asOf = день до weekStart, окно = 89 дней назад", () => {
    const { asOf, from } = windowBounds("2026-07-27");
    assert.equal(asOf, "2026-07-26");
    assert.equal(daysBetween(from, asOf), 89);
  });
});

describe("riskReason", () => {
  it("ежедневный гость формулируется по-человечески", () => {
    assert.equal(riskReason(1, 5), "Заходил почти каждый день, не был уже 5 дн.");
  });
  it("обычный интервал округляется", () => {
    assert.equal(riskReason(3, 10), "Обычно заходит раз в 3 дн., не был уже 10 дн.");
  });
});

describe("findCandidates", () => {
  const asOf = "2026-07-26";
  const spend = new Map<string, number>();
  const run = (visits: Map<string, string[]>) => findCandidates(visits, spend, asOf);

  it("гость в своём ритме — пропускаем", () => {
    // Каждые 3 дня, последний визит прямо на отсечку → тишины нет.
    const v = new Map([["g", series(asOf, 3, 5)]]);
    assert.equal(run(v).length, 0);
  });

  it("затихший завсегдатай → когорта 5plus", () => {
    // Ежедневный гость, молчит 16 дней.
    const v = new Map([["g", series("2026-07-10", 1, 10)]]);
    const c = run(v);
    assert.equal(c.length, 1);
    assert.equal(c[0].cohort, "5plus");
  });

  it("средней частоты с провалом → когорта 2-4", () => {
    // Раз в ~10 дней, последний визит ~57 дней назад.
    const v = new Map([["g", series("2026-05-31", 10, 4)]]);
    const c = run(v);
    assert.equal(c.length, 1);
    assert.equal(c[0].cohort, "2-4");
  });

  it("редкий гость (реже раза в 3 недели) → не берём", () => {
    const v = new Map([["g", series("2026-04-04", 31, 4)]]);
    assert.equal(run(v).length, 0);
  });

  it("мало визитов (< minVisits) → пропускаем", () => {
    const v = new Map([["g", series("2026-07-01", 3, 3)]]);
    assert.equal(run(v).length, 0);
  });

  it("сортировка по тратам: ценные первыми", () => {
    const v = new Map([
      ["low", series("2026-07-10", 1, 10)],
      ["high", series("2026-07-10", 1, 10)],
    ]);
    const s = new Map([
      ["low", 1000],
      ["high", 5000],
    ]);
    const c = findCandidates(v, s, asOf);
    assert.equal(c.length, 2);
    assert.equal(c[0].guestIikoId, "high");
  });
});
