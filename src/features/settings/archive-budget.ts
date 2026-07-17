import { eq, or } from "drizzle-orm";
import type { AppDatabase } from "../../db/client";
import { normalizeIsoDate } from "../../db/normalize-date";
import { accounts, recurringRules } from "../../db/schema";

export async function archiveBudgetAndRules(
  db: AppDatabase,
  accountId: string,
  archivedAt: string
): Promise<void> {
  const normalizedArchivedAt = normalizeIsoDate(archivedAt);
  const updatedAt = new Date().toISOString();

  // AppDatabase は sync driver のため、transaction callback 内の全操作を同期実行する。
  // 対象口座が存在しない場合も、先行したルール削除を含めてロールバックされる。
  db.transaction((tx) => {
    tx.delete(recurringRules)
      .where(
        or(
          eq(recurringRules.fromAccountId, accountId),
          eq(recurringRules.toAccountId, accountId)
        )
      )
      .run();

    const account = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (!account) {
      throw new Error(`account not found: ${accountId}`);
    }

    tx.update(accounts)
      .set({ archivedAt: normalizedArchivedAt, updatedAt })
      .where(eq(accounts.id, accountId))
      .run();
  });
}
