import { deriveBalance } from "../../domain";
import type { Transaction } from "../../domain/types";

export function canArchiveAccount(accountId: string, transactions: Transaction[]): boolean {
  return deriveBalance(accountId, transactions) === 0;
}
