import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addWeeks,
  isoWeekNumber,
  segmentLabel,
  segmentOf,
  weekStart,
  weekStartDate,
} from "./weeks.js";

describe("weekStart", () => {
  it("возвращает понедельник (UTC)", () => {
    for (const d of ["2026-07-28", "2026-07-27", "2026-08-02", "2026-01-01"]) {
      const ws = weekStart(new Date(d + "T12:00:00Z"));
      assert.equal(weekStartDate(ws).getUTCDay(), 1, `${d} → ${ws}`);
    }
  });

  it("вторник 2026-07-28 → понедельник 2026-07-27", () => {
    assert.equal(weekStart(new Date("2026-07-28T09:00:00Z")), "2026-07-27");
  });

  it("идемпотентен: понедельник маппится сам в себя", () => {
    assert.equal(weekStart(weekStartDate("2021-01-04")), "2021-01-04");
  });
});

describe("addWeeks", () => {
  it("+1 неделя = +7 дней", () => {
    assert.equal(addWeeks("2021-01-04", 1), "2021-01-11");
  });
  it("обратима: +n затем −n", () => {
    assert.equal(addWeeks(addWeeks("2026-07-27", 5), -5), "2026-07-27");
  });
  it("работает через границу месяца/года", () => {
    assert.equal(addWeeks("2025-12-29", 1), "2026-01-05");
  });
});

describe("isoWeekNumber", () => {
  it("2021-01-04 — неделя 1", () => {
    assert.equal(isoWeekNumber("2021-01-04"), 1);
  });
  it("возвращает 1..53", () => {
    for (let n = -30; n <= 30; n++) {
      const w = isoWeekNumber(addWeeks("2026-07-27", n));
      assert.ok(w >= 1 && w <= 53, `неделя вне диапазона: ${w}`);
    }
  });
});

describe("segmentOf", () => {
  it("0 и меньше → 0", () => {
    assert.equal(segmentOf(0), 0);
    assert.equal(segmentOf(-3), 0);
  });
  it("1..6 без изменений", () => {
    for (let v = 1; v <= 6; v++) assert.equal(segmentOf(v), v);
  });
  it("7 и больше → 7", () => {
    assert.equal(segmentOf(7), 7);
    assert.equal(segmentOf(30), 7);
  });
});

describe("segmentLabel", () => {
  it("7 → «7+», остальное как есть", () => {
    assert.equal(segmentLabel(7), "7+");
    assert.equal(segmentLabel("7"), "7+");
    assert.equal(segmentLabel(3), "3");
  });
});
