import { and, eq, isNull, like } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { generateId } from "../../db/id";
import { accounts, recurringRules, transactions } from "../../db/schema";
import type { Account, RecurringRule } from "../../domain/types";

export type UpdateBudgetInput = {
  name: string;
  monthlyBudget: number;
};

export type UpdatedBudget = {
  account: Account;
  monthlyRule: RecurringRule | null;
};

/**
 * 予算名・月額と、対応する月初 income ルールを同じトランザクションで同期する。
 * 既存ルールの先頭 ID は、当月の生成済み取引との対応を保つため変更しない。
 */
export async function updateBudgetAndMonthlyRule(
  db: AppDatabase,
  accountId: string,
  input: UpdateBudgetInput
): Promise<UpdatedBudget> {
  const name = input.name.trim();
  if (!name) throw new Error("budget name is required");
  if (!Number.isSafeInteger(input.monthlyBudget) || input.monthlyBudget < 0) {
    throw new Error("monthly budget must be a non-negative safe integer");
  }

  let result: UpdatedBudget | undefined;
  db.transaction((tx) => {
    const accountRow = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!accountRow) throw new Error(`account not found: ${accountId}`);
    if (accountRow.type !== "budget") throw new Error(`account is not a budget: ${accountId}`);

    const monthlyRules = tx
      .select()
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.type, "income"),
          eq(recurringRules.toAccountId, accountId),
          eq(recurringRules.dayOfMonth, 1),
          isNull(recurringRules.fromAccountId),
          isNull(recurringRules.cardId)
        )
      )
      .all();
    const monthlyRuleIds = new Set(monthlyRules.map((rule) => rule.id));
    const currentMonthTransactions =
      monthlyRuleIds.size === 0
        ? []
        : tx
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.type, "income"),
                eq(transactions.toAccountId, accountId),
                like(transactions.date, `${localYearMonth()}-%`),
                isNull(transactions.deletedAt)
              )
            )
            .all()
            .filter(
              (transaction) =>
                transaction.recurringRuleId !== null &&
                monthlyRuleIds.has(transaction.recurringRuleId)
            );

    const updatedAt = new Date().toISOString();
    tx.update(accounts)
      .set({ name, monthlyBudget: input.monthlyBudget, updatedAt })
      .where(eq(accounts.id, accountId))
      .run();

    let monthlyRule: RecurringRule | null = null;
    if (input.monthlyBudget === 0) {
      for (const rule of monthlyRules) {
        tx.delete(recurringRules).where(eq(recurringRules.id, rule.id)).run();
      }
      for (const transaction of currentMonthTransactions) {
        tx.update(transactions)
          .set({ deletedAt: updatedAt, updatedAt })
          .where(eq(transactions.id, transaction.id))
          .run();
      }
    } else if (monthlyRules.length > 0) {
      const [keeper, ...duplicates] = monthlyRules;
      tx.update(recurringRules)
        .set({ amount: input.monthlyBudget })
        .where(eq(recurringRules.id, keeper.id))
        .run();
      for (const duplicate of duplicates) {
        tx.delete(recurringRules).where(eq(recurringRules.id, duplicate.id)).run();
      }
      const keeperTransactions = currentMonthTransactions.filter(
        (transaction) => transaction.recurringRuleId === keeper.id
      );
      const [keeperTransaction, ...duplicateKeeperTransactions] = keeperTransactions;
      if (keeperTransaction) {
        tx.update(transactions)
          .set({ amount: input.monthlyBudget, updatedAt })
          .where(eq(transactions.id, keeperTransaction.id))
          .run();
      }
      for (const transaction of currentMonthTransactions) {
        if (
          transaction.recurringRuleId !== keeper.id ||
          duplicateKeeperTransactions.some((duplicate) => duplicate.id === transaction.id)
        ) {
          tx.update(transactions)
            .set({ deletedAt: updatedAt, updatedAt })
            .where(eq(transactions.id, transaction.id))
            .run();
        }
      }
      monthlyRule = toRecurringRule({ ...keeper, amount: input.monthlyBudget });
    } else {
      const row: typeof recurringRules.$inferInsert = {
        id: generateId(),
        type: "income",
        amount: input.monthlyBudget,
        fromAccountId: null,
        toAccountId: accountId,
        cardId: null,
        memo: "月初充当",
        dayOfMonth: 1,
      };
      tx.insert(recurringRules).values(row).run();
      monthlyRule = toRecurringRule(row);
    }

    result = {
      account: toAccount({
        ...accountRow,
        name,
        monthlyBudget: input.monthlyBudget,
        updatedAt,
      }),
      monthlyRule,
    };
  });

  if (!result) throw new Error("budget update did not complete");
  return result;
}

function localYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function toAccount(row: typeof accounts.$inferSelect): Account {
  return { ...row, type: row.type as Account["type"] };
}

function toRecurringRule(
  row: typeof recurringRules.$inferSelect | typeof recurringRules.$inferInsert
): RecurringRule {
  return {
    id: row.id,
    type: row.type as RecurringRule["type"],
    amount: row.amount,
    fromAccountId: row.fromAccountId ?? null,
    toAccountId: row.toAccountId ?? null,
    cardId: row.cardId ?? null,
    memo: row.memo,
    dayOfMonth: row.dayOfMonth,
  };
}
