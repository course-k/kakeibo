import { isValidAmount } from "../../domain/amount";
import type { Card, Transaction } from "../../domain/types";

export type CardSettlementTransactionInput = Pick<
  Transaction,
  "date" | "amount" | "type" | "fromAccountId" | "toAccountId" | "cardId" | "memo" | "recurringRuleId"
>;

export type BuildCardSettlementInput = {
  card: Card;
  paidAmount: number;
  date: string;
};

function makeMemo(cardName: string): string {
  return `${cardName} 消し込み`;
}

export function buildCardSettlementTransactions({
  card,
  paidAmount,
  date,
}: BuildCardSettlementInput): CardSettlementTransactionInput {
  if (!isValidAmount(paidAmount)) {
    throw new Error("paidAmount must be a positive integer");
  }

  return {
    date,
    amount: paidAmount,
    type: "card_debit",
    fromAccountId: card.settlementAccountId,
    toAccountId: null,
    cardId: card.id,
    memo: makeMemo(card.name),
    recurringRuleId: null,
  };
}
