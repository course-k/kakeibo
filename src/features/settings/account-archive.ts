import type { Transaction } from "../../domain/types";

type ArchiveTransaction = Pick<
  Transaction,
  "date" | "amount" | "fromAccountId" | "toAccountId" | "deletedAt"
>;

export type ArchiveBlockReason = "non_zero_balance" | "future_transaction";

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

export function archiveBlockReason(
  accountId: string,
  transactions: ArchiveTransaction[],
  asOf: string,
): ArchiveBlockReason | null {
  let balance = 0;

  for (const transaction of transactions) {
    if (transaction.deletedAt !== null) continue;
    const referencesAccount =
      transaction.fromAccountId === accountId || transaction.toAccountId === accountId;
    if (!referencesAccount) continue;
    if (transaction.date > asOf) return "future_transaction";
    if (transaction.toAccountId === accountId) balance += transaction.amount;
    if (transaction.fromAccountId === accountId) balance -= transaction.amount;
  }

  return balance === 0 ? null : "non_zero_balance";
}

export function canArchiveAccount(
  accountId: string,
  transactions: ArchiveTransaction[],
  asOf: string = localToday(),
): boolean {
  return archiveBlockReason(accountId, transactions, asOf) === null;
}
