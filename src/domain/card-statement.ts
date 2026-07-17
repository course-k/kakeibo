// カードごとの支払準備総額を取引から導出する。
// 締め日・引き落とし日だけでは実際の請求周期を一意に決められないため、
// 今回請求分/次回以降分は推定しない。実引き落とし額は明細確認後に入力する。
import { deriveBalance } from "./balance";
import type { Card, Transaction } from "./types";

/**
 * today 時点のカード支払準備総額を返す。
 * expense_card、card_debit、adjustment を含む決済口座の全取引から導出し、
 * 過払い・不整合による負値も警告表示に使えるよう丸めず保持する。
 */
export function deriveCardPreparedAmount(
  card: Card,
  transactions: Transaction[],
  today: string
): number {
  return deriveBalance(card.settlementAccountId, transactions, today);
}

/** カード履歴1件が支払準備総額を増減させる符号付き金額を返す。 */
export function deriveCardPreparedChange(card: Card, transaction: Transaction): number {
  let change = 0;
  if (transaction.toAccountId === card.settlementAccountId) change += transaction.amount;
  if (transaction.fromAccountId === card.settlementAccountId) change -= transaction.amount;
  return change;
}

/** cardId導入前のsettlement adjustmentも、対応カードの履歴として扱う。 */
export function isCardPreparedTransaction(card: Card, transaction: Transaction): boolean {
  if (transaction.cardId === card.id) return true;
  if (transaction.type !== "adjustment" || transaction.cardId !== null) return false;
  return (
    transaction.fromAccountId === card.settlementAccountId ||
    transaction.toAccountId === card.settlementAccountId
  );
}
