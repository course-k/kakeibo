import { isValidAmount } from "../../domain/amount";
import type { Card, Transaction } from "../../domain/types";

export type CardSettlementTransactionInput = Pick<
  Transaction,
  "date" | "amount" | "type" | "fromAccountId" | "toAccountId" | "cardId" | "memo" | "recurringRuleId"
>;

export type BuildCardSettlementInput = {
  card: Card;
  currentAmount: number;
  paidAmount: number;
  date: string;
};

export type BuiltCardSettlement = {
  cardDebit: CardSettlementTransactionInput;
  adjustment: CardSettlementTransactionInput | null;
};

function makeMemo(cardName: string, kind: "debit" | "adjustment"): string {
  return kind === "debit" ? `${cardName} 消し込み` : `${cardName} 消し込み差額`;
}

/**
 * 差額 = 入力額 - 今回請求分。
 * 入力額が多い場合は card_debit 後に残高が負へ振れるため to 側 adjustment で戻し、
 * 入力額が少ない場合は残高が残るため from 側 adjustment で落とす。
 */
export function buildCardSettlementTransactions({
  card,
  currentAmount,
  paidAmount,
  date,
}: BuildCardSettlementInput): BuiltCardSettlement {
  if (!isValidAmount(paidAmount)) {
    throw new Error("paidAmount must be a positive integer");
  }

  const cardDebit: CardSettlementTransactionInput = {
    date,
    amount: paidAmount,
    type: "card_debit",
    fromAccountId: card.settlementAccountId,
    toAccountId: null,
    cardId: card.id,
    memo: makeMemo(card.name, "debit"),
    recurringRuleId: null,
  };

  const diff = paidAmount - currentAmount;
  if (diff === 0) {
    return { cardDebit, adjustment: null };
  }

  const amount = Math.abs(diff);
  if (!isValidAmount(amount)) {
    throw new Error("adjustment amount must be a positive integer");
  }

  const adjustment: CardSettlementTransactionInput = {
    date,
    amount,
    type: "adjustment",
    fromAccountId: diff < 0 ? card.settlementAccountId : null,
    toAccountId: diff > 0 ? card.settlementAccountId : null,
    cardId: null,
    memo: makeMemo(card.name, "adjustment"),
    recurringRuleId: null,
  };

  return { cardDebit, adjustment };
}
