import type { TransactionPatch } from "../../db/transactions-repository";
import { normalizeIsoDate } from "../../db/normalize-date";
import type { Transaction } from "../../domain/types";
import { amountFromText } from "./input-logic";

export type CardDebitEditState = {
  amountText: string;
  date: string;
  memo: string;
};

export function createCardDebitEditState(transaction: Transaction): CardDebitEditState {
  if (transaction.type !== "card_debit") {
    throw new Error("カード引き落とし以外はこの画面で訂正できません");
  }
  return {
    amountText: String(transaction.amount),
    date: transaction.date,
    memo: transaction.memo,
  };
}

/** type/from/to/cardId/recurringRuleId を触らず、訂正可能な3項目だけを返す。 */
export function buildCardDebitEditPatch(
  transaction: Transaction,
  state: CardDebitEditState,
  today: string
): TransactionPatch {
  if (transaction.type !== "card_debit") {
    throw new Error("カード引き落とし以外はこの画面で訂正できません");
  }
  const amount = amountFromText(state.amountText);
  if (amount === null) {
    throw new Error("金額は正の整数で入力してください");
  }
  const date = normalizeIsoDate(state.date);
  if (date > today) {
    throw new Error("未来の日付は記録できません");
  }
  if (
    transaction.recurringRuleId !== null &&
    date.slice(0, 7) !== transaction.date.slice(0, 7)
  ) {
    throw new Error("定期取引は別の月へ移動できません");
  }
  return { amount, date, memo: state.memo };
}
