import type { NewRecurringRuleInput } from "../../db/recurring-rules-repository";

export type MonthlyBudgetRuleInput = {
  budgetAccountId: string;
  amount: number;
  memo?: string;
};

export function buildMonthlyBudgetIncomeRule(
  input: MonthlyBudgetRuleInput
): NewRecurringRuleInput {
  return {
    ruleKind: "budget_allocation",
    type: "income",
    amount: input.amount,
    fromAccountId: null,
    toAccountId: input.budgetAccountId,
    cardId: null,
    categoryId: null,
    memo: input.memo ?? "月初充当",
    dayOfMonth: 1,
  };
}
