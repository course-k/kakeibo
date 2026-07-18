import type { AppDatabase } from "../../db/client";
import { generateId } from "../../db/id";
import { accounts as accountsTable, recurringRules as recurringRulesTable } from "../../db/schema";
import type { Account, RecurringRule } from "../../domain/types";

export type CreateBudgetInput = {
  name: string;
  monthlyBudget: number;
  sortOrder: number;
};

export type CreatedBudgetWithMonthlyRule = {
  account: Account;
  recurringRule: RecurringRule | null;
};

export async function createBudgetWithMonthlyRule(
  db: AppDatabase,
  input: CreateBudgetInput
): Promise<CreatedBudgetWithMonthlyRule> {
  const now = new Date().toISOString();
  const account: Account = {
    id: generateId(),
    name: input.name,
    type: "budget",
    monthlyBudget: input.monthlyBudget,
    ownerId: null,
    sortOrder: input.sortOrder,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const recurringRule: RecurringRule | null =
    input.monthlyBudget > 0
      ? {
          id: generateId(),
          ruleKind: "budget_allocation",
          type: "income",
          amount: input.monthlyBudget,
          fromAccountId: null,
          toAccountId: account.id,
          cardId: null,
          categoryId: null,
          memo: "月初充当",
          dayOfMonth: 1,
        }
      : null;

  // AppDatabase は sync driver のため、transaction callback 内で同期 insert する。
  // 月初ルールの作成に失敗した場合は、先行する予算口座もロールバックされる。
  db.transaction((tx) => {
    tx.insert(accountsTable).values(account).run();
    if (recurringRule) {
      tx.insert(recurringRulesTable).values(recurringRule).run();
    }
  });

  return { account, recurringRule };
}
