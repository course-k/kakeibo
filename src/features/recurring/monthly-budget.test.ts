import { describe, expect, it } from "vitest";
import { buildMonthlyBudgetIncomeRule } from "./monthly-budget";

describe("buildMonthlyBudgetIncomeRule", () => {
  it("月初充当を income/dayOfMonth=1/toAccountId=予算口座 として作る", () => {
    expect(
      buildMonthlyBudgetIncomeRule({
        budgetAccountId: "budget-1",
        amount: 50000,
      })
    ).toEqual({
      type: "income",
      amount: 50000,
      fromAccountId: null,
      toAccountId: "budget-1",
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 1,
    });
  });
});
