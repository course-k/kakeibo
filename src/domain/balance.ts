// 口座残高の導出。残高カラムは持たず、取引集計から都度導出する。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.2 導出値 / §2.3 不変条件 3・5
import type { Account, Transaction } from "./types";

/** 論理削除されていない取引のみを対象にする（不変条件 5）。 */
function isActive(tx: Transaction): boolean {
  return tx.deletedAt === null;
}

/**
 * 指定口座の残高を導出する。
 * 残高 = to とする取引の合計（＋）− from とする取引の合計（−）。
 * 論理削除された取引は集計から除外される。
 */
export function deriveBalance(accountId: string, transactions: Transaction[]): number {
  let balance = 0;
  for (const tx of transactions) {
    if (!isActive(tx)) continue;
    if (tx.toAccountId === accountId) balance += tx.amount;
    if (tx.fromAccountId === accountId) balance -= tx.amount;
  }
  return balance;
}

/** 全口座の残高を { accountId: 残高 } の形で導出する。 */
export function deriveAllBalances(
  accounts: Account[],
  transactions: Transaction[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const account of accounts) {
    result[account.id] = deriveBalance(account.id, transactions);
  }
  return result;
}
