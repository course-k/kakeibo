import type { NewTransactionInput } from "../../db/transactions-repository";

export type InitialBalanceInput = {
  accountId: string;
  cardId?: string | null;
  amount: number;
  date: string;
  memo?: string;
};

export function buildInitialBalanceAdjustment(input: InitialBalanceInput): NewTransactionInput {
  const amount = Math.abs(input.amount);
  return {
    date: input.date,
    amount,
    type: "adjustment",
    fromAccountId: input.amount < 0 ? input.accountId : null,
    toAccountId: input.amount >= 0 ? input.accountId : null,
    cardId: input.cardId ?? null,
    memo: input.memo ?? "初期残高",
    recurringRuleId: null,
  };
}
