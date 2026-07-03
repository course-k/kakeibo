import { describe, expect, it } from "vitest";
import { expandRecurring } from "./recurring";

describe("expandRecurring", () => {
  it("月範囲の各月に 1 件ずつ展開する", () => {
    const rule = {
      id: "rule-1",
      type: "income" as const,
      amount: 300000,
      fromAccountId: null,
      toAccountId: "budget-1",
      cardId: null,
      memo: "給与",
      dayOfMonth: 25,
    };
    const drafts = expandRecurring(rule, { from: "2026-01", to: "2026-03" });
    expect(drafts.map((d) => d.date)).toEqual(["2026-01-25", "2026-02-25", "2026-03-25"]);
    expect(drafts.every((d) => d.recurringRuleId === "rule-1")).toBe(true);
    expect(drafts.every((d) => d.type === "income" && d.amount === 300000)).toBe(true);
  });

  it("単月範囲は 1 件のみ展開する", () => {
    const rule = {
      id: "rule-2",
      type: "expense_cash" as const,
      amount: 1000,
      fromAccountId: "budget-1",
      toAccountId: null,
      cardId: null,
      memo: "",
      dayOfMonth: 1,
    };
    const drafts = expandRecurring(rule, { from: "2026-05", to: "2026-05" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].date).toBe("2026-05-01");
  });

  it("dayOfMonth=31 は月末に丸める（不変条件的な締め日ロジックと同じ丸め規則）", () => {
    const rule = {
      id: "rule-3",
      type: "income" as const,
      amount: 1000,
      fromAccountId: null,
      toAccountId: "budget-1",
      cardId: null,
      memo: "",
      dayOfMonth: 31,
    };
    const drafts = expandRecurring(rule, { from: "2026-02", to: "2026-04" });
    // 2026年は平年 -> 2月は28日、4月は30日、5月は31日ではなく3月まで
    expect(drafts.map((d) => d.date)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });
});
