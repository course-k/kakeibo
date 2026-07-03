import { describe, expect, it } from "vitest";
import { buildInitialBalanceAdjustment } from "./initial-balance";

describe("buildInitialBalanceAdjustment", () => {
  it("初期残高を adjustment 取引として組み立てる", () => {
    expect(buildInitialBalanceAdjustment({ accountId: "wallet", amount: 1200, date: "2026-07-03" })).toEqual({
      date: "2026-07-03",
      amount: 1200,
      type: "adjustment",
      fromAccountId: null,
      toAccountId: "wallet",
      cardId: null,
      memo: "初期残高",
      recurringRuleId: null,
    });

    expect(buildInitialBalanceAdjustment({ accountId: "wallet", amount: -500, date: "2026-07-03", memo: "補正" })).toMatchObject({
      amount: 500,
      fromAccountId: "wallet",
      toAccountId: null,
      memo: "補正",
    });
  });
});
