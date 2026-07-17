import { eq, or } from "drizzle-orm";
import type { AppDatabase } from "../../db/client";
import { normalizeIsoDate } from "../../db/normalize-date";
import { accounts, recurringRules, transactions } from "../../db/schema";
import { archiveBlockReason } from "./account-archive";

export async function archiveBudgetAndRules(
  db: AppDatabase,
  accountId: string,
  archivedAt: string
): Promise<void> {
  const normalizedArchivedAt = normalizeIsoDate(archivedAt);
  const updatedAt = new Date().toISOString();

  // AppDatabase は sync driver のため、transaction callback 内の全操作を同期実行する。
  // 残高・未来取引の再検査からルール削除、終了までを同じ transaction に置く。
  db.transaction((tx) => {
    const account = tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (!account) {
      throw new Error("終了する予算が見つかりません。");
    }
    if (account.type !== "budget") {
      throw new Error(`「${account.name}」は予算ではないため終了できません。`);
    }
    if (account.archivedAt !== null) {
      throw new Error(`「${account.name}」はすでに終了しています。`);
    }

    const reason = archiveBlockReason(
      accountId,
      tx.select().from(transactions).all(),
      normalizedArchivedAt,
    );
    if (reason === "future_transaction") {
      throw new Error(
        `「${account.name}」には${normalizedArchivedAt}より後の取引があるため終了できません。`,
      );
    }
    if (reason === "non_zero_balance") {
      throw new Error(
        `「${account.name}」の${normalizedArchivedAt}時点の残額が0円ではありません。`,
      );
    }

    tx.delete(recurringRules)
      .where(
        or(
          eq(recurringRules.fromAccountId, accountId),
          eq(recurringRules.toAccountId, accountId)
        )
      )
      .run();

    tx.update(accounts)
      .set({ archivedAt: normalizedArchivedAt, updatedAt })
      .where(eq(accounts.id, accountId))
      .run();
  });
}
