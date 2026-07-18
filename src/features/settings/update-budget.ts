import { and, eq, isNull } from "drizzle-orm";

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
          eq(recurringRules.ruleKind, "budget_allocation"),
          eq(recurringRules.type, "income"),
          eq(recurringRules.toAccountId, accountId),
          eq(recurringRules.dayOfMonth, 1),
          isNull(recurringRules.fromAccountId),
          isNull(recurringRules.cardId)
        )
      )
      .all();
    const monthlyRuleIds = new Set(monthlyRules.map((rule) => rule.id));
    const knownRuleIds = new Set(
      tx.select({ id: recurringRules.id }).from(recurringRules).all().map((rule) => rule.id)
    );
    const currentMonth = localYearMonth();
    const allStructuralIncomeTransactions = tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "income"),
          eq(transactions.toAccountId, accountId),
          isNull(transactions.fromAccountId),
          isNull(transactions.cardId)
        )
      )
      .all()
      .filter((transaction) => transaction.recurringRuleId !== null);
    const ruleTransactions = allStructuralIncomeTransactions.filter((transaction) =>
      monthlyRuleIds.has(transaction.recurringRuleId as string)
    );
    const allCurrentMonthTransactions = ruleTransactions.filter(
      (transaction) => transaction.date.slice(0, 7) === currentMonth
    );
    const currentMonthTransactions = allCurrentMonthTransactions.filter(
      (transaction) => transaction.deletedAt === null
    );
    const orphanMonthlyTransactions = allStructuralIncomeTransactions.filter(
      (transaction) =>
        transaction.memo === "月初充当" &&
        !knownRuleIds.has(transaction.recurringRuleId as string)
    );
    const currentMonthOrphans = orphanMonthlyTransactions.filter(
      (transaction) => transaction.date.slice(0, 7) === currentMonth
    );
    const activeOrphans = currentMonthOrphans.filter(
      (transaction) => transaction.deletedAt === null
    );

    const updatedAt = new Date().toISOString();
    tx.update(accounts)
      .set({ name, monthlyBudget: input.monthlyBudget, updatedAt })
      .where(eq(accounts.id, accountId))
      .run();

    let monthlyRule: RecurringRule | null = null;
    if (input.monthlyBudget === 0) {
      const markerId =
        monthlyRules[0]?.id ?? orphanMonthlyTransactions[0]?.recurringRuleId ?? undefined;
      for (const rule of monthlyRules) {
        tx.delete(recurringRules).where(eq(recurringRules.id, rule.id)).run();
      }
      for (const transaction of [
        ...ruleTransactions,
        ...orphanMonthlyTransactions,
      ]) {
        const isCurrentMonth = transaction.date.slice(0, 7) === currentMonth;
        tx.update(transactions)
          .set({
            deletedAt:
              isCurrentMonth && transaction.deletedAt === null
                ? updatedAt
                : transaction.deletedAt,
            updatedAt,
            ...(markerId ? { recurringRuleId: markerId } : {}),
          })
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
      const keeperTransaction =
        keeperTransactions[0] ?? currentMonthTransactions[0] ?? activeOrphans[0];
      if (keeperTransaction) {
        tx.update(transactions)
          .set({
            amount: input.monthlyBudget,
            recurringRuleId: keeper.id,
            updatedAt,
          })
          .where(eq(transactions.id, keeperTransaction.id))
          .run();
      }
      for (const transaction of [
        ...ruleTransactions,
        ...orphanMonthlyTransactions,
      ]) {
        if (transaction.id !== keeperTransaction?.id) {
          const isCurrentMonth = transaction.date.slice(0, 7) === currentMonth;
          tx.update(transactions)
            .set({
              deletedAt:
                isCurrentMonth && transaction.deletedAt === null
                  ? updatedAt
                  : transaction.deletedAt,
              updatedAt,
              recurringRuleId: keeper.id,
            })
            .where(eq(transactions.id, transaction.id))
            .run();
        }
      }
      monthlyRule = toRecurringRule({ ...keeper, amount: input.monthlyBudget });
    } else {
      const orphan =
        activeOrphans[0] ?? currentMonthOrphans[0] ?? orphanMonthlyTransactions[0];
      const row: typeof recurringRules.$inferInsert = {
        // 旧データに生成済み/削除済みmarkerが1件だけあればIDを引き継ぎ、
        // 二重充当や削除済み取引の復活を防ぐ。
        id: orphan?.recurringRuleId ?? generateId(),
        ruleKind: "budget_allocation",
        type: "income",
        amount: input.monthlyBudget,
        fromAccountId: null,
        toAccountId: accountId,
        cardId: null,
        categoryId: null,
        memo: "月初充当",
        dayOfMonth: 1,
      };
      tx.insert(recurringRules).values(row).run();
      for (const transaction of orphanMonthlyTransactions) {
        const isCurrentMonth = transaction.date.slice(0, 7) === currentMonth;
        const isKeeper = transaction.id === orphan?.id;
        tx.update(transactions)
          .set({
            recurringRuleId: row.id,
            updatedAt,
            ...(isCurrentMonth && isKeeper && transaction.deletedAt === null
              ? { amount: input.monthlyBudget }
              : {}),
            ...(isCurrentMonth && !isKeeper && transaction.deletedAt === null
              ? { deletedAt: updatedAt }
              : {}),
          })
          .where(eq(transactions.id, transaction.id))
          .run();
      }
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
