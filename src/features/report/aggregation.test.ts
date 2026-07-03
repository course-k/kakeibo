import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "../../domain/types";
import { summarizeMonthlyBudgetExpenses } from "./aggregation";

const accounts: Account[] = [
  {
    id: "food",
    name: "食費",
    type: "budget",
    monthlyBudget: 50000,
    ownerId: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "daily",
    name: "日用品",
    type: "budget",
    monthlyBudget: 10000,
    ownerId: null,
    sortOrder: 1,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "settlement",
    name: "カード決済",
    type: "card_settlement",
    monthlyBudget: 0,
    ownerId: null,
    sortOrder: 2,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
];

function tx(input: Partial<Transaction> & Pick<Transaction, "id" | "date" | "amount" | "type">): Transaction {
  return {
    fromAccountId: null,
    toAccountId: null,
    cardId: null,
    memo: "",
    recurringRuleId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    ...input,
  };
}

describe("summarizeMonthlyBudgetExpenses", () => {
  it("月×予算口座別支出と月次推移を expense_cash/expense_card から集計する", () => {
    const summary = summarizeMonthlyBudgetExpenses(accounts, [
      tx({ id: "july-food-cash", date: "2026-07-03", amount: 1000, type: "expense_cash", fromAccountId: "food" }),
      tx({ id: "july-food-card", date: "2026-07-04", amount: 2000, type: "expense_card", fromAccountId: "food", toAccountId: "settlement" }),
      tx({ id: "july-daily", date: "2026-07-05", amount: 500, type: "expense_cash", fromAccountId: "daily" }),
      tx({ id: "aug-food", date: "2026-08-01", amount: 700, type: "expense_cash", fromAccountId: "food" }),
      tx({ id: "transfer", date: "2026-07-06", amount: 9999, type: "transfer", fromAccountId: "food", toAccountId: "daily" }),
      tx({ id: "deleted", date: "2026-07-07", amount: 9999, type: "expense_cash", fromAccountId: "food", deletedAt: "2026-07-08T00:00:00.000Z" }),
    ]);

    expect(summary.byAccount).toEqual([
      { month: "2026-07", accountId: "daily", accountName: "日用品", amount: 500 },
      { month: "2026-07", accountId: "food", accountName: "食費", amount: 3000 },
      { month: "2026-08", accountId: "food", accountName: "食費", amount: 700 },
    ]);
    expect(summary.monthlyTrend).toEqual([
      { month: "2026-07", amount: 3500 },
      { month: "2026-08", amount: 700 },
    ]);
  });
});
