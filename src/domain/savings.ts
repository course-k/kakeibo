// 「貯まり」（全 budget 口座残高の合計）の導出。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.2 導出値
import { deriveBalance } from "./balance";
import type { Account, Transaction } from "./types";

/**
 * 貯まり = 全 budget 口座残高の合計。
 * アーカイブ済み口座を除外するかは呼び出し側の責務とする
 * （渡された accounts のうち type === 'budget' のものをすべて合算する）。
 */
export function deriveSavings(accounts: Account[], transactions: Transaction[], asOf?: string): number {
  return accounts
    .filter((a) => a.type === "budget")
    .reduce((sum, a) => sum + deriveBalance(a.id, transactions, asOf), 0);
}
