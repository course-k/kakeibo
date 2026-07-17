import { eq, or } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { accounts, recurringRules } from "../../db/schema";
import type { Account } from "../../domain/types";

/**
 * 終了済みの予算を、毎月の自動充当を再設定せずに利用可能へ戻す。
 * archivedAt と monthlyBudget は同じトランザクションで更新する。
 */
export async function reopenBudget(
  db: AppDatabase,
  accountId: string
): Promise<Account> {
  let result: Account | undefined;

  db.transaction((tx) => {
    const account = tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();

    if (!account) throw new Error(`account not found: ${accountId}`);
    if (account.type !== "budget") throw new Error(`account is not a budget: ${accountId}`);
    if (account.archivedAt === null) throw new Error(`budget is already active: ${accountId}`);

    const updatedAt = new Date().toISOString();
    // 古いバックアップや旧版でルールが残っていても、自動充当を暗黙再開しない。
    tx.delete(recurringRules)
      .where(
        or(
          eq(recurringRules.fromAccountId, accountId),
          eq(recurringRules.toAccountId, accountId)
        )
      )
      .run();
    tx.update(accounts)
      .set({ archivedAt: null, monthlyBudget: 0, updatedAt })
      .where(eq(accounts.id, accountId))
      .run();

    result = {
      ...account,
      type: "budget",
      archivedAt: null,
      monthlyBudget: 0,
      updatedAt,
    };
  });

  if (!result) throw new Error("budget reopen did not complete");
  return result;
}
