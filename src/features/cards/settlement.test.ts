import { describe, expect, it } from "vitest";
import { deriveCardStatement } from "../../domain";
import type { Transaction } from "../../domain/types";
import { makeCard, makeTransaction } from "../../domain/test-fixtures";
import {
  buildCardSettlementTransactions,
  type BuiltCardSettlement,
} from "./settlement";

function appendBuiltSettlement(
  txs: Transaction[],
  built: BuiltCardSettlement
): Transaction[] {
  const now = "2026-02-01T00:00:00.000Z";
  const additions = [built.cardDebit, built.adjustment]
    .filter((tx): tx is NonNullable<typeof tx> => tx !== null)
    .map((tx, index): Transaction => ({
      id: `settlement-${index + 1}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...tx,
    }));
  return [...txs, ...additions];
}

describe("buildCardSettlementTransactions", () => {
  it("今回請求分と同額なら card_debit のみを組み立てる", () => {
    const card = makeCard({ id: "card-1", name: "Visa", settlementAccountId: "settle-1" });
    const built = buildCardSettlementTransactions({
      card,
      currentAmount: 3000,
      paidAmount: 3000,
      date: "2026-02-27",
    });

    expect(built.cardDebit).toEqual({
      date: "2026-02-27",
      amount: 3000,
      type: "card_debit",
      fromAccountId: "settle-1",
      toAccountId: null,
      cardId: "card-1",
      memo: "Visa 消し込み",
      recurringRuleId: null,
    });
    expect(built.adjustment).toBeNull();
  });

  it("入力額が今回請求分より少ない場合は from 側 adjustment で残額を落とす", () => {
    const card = makeCard({
      id: "card-1",
      name: "Visa",
      settlementAccountId: "settle-1",
      closingDay: 15,
    });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-10",
      }),
    ];
    const built = buildCardSettlementTransactions({
      card,
      currentAmount: 3000,
      paidAmount: 2800,
      date: "2026-02-27",
    });

    expect(built.adjustment).toMatchObject({
      amount: 200,
      type: "adjustment",
      fromAccountId: "settle-1",
      toAccountId: null,
      cardId: null,
    });
    const result = deriveCardStatement(card, appendBuiltSettlement(txs, built), "2026-03-01");
    expect(result).toEqual({ currentAmount: 0, nextAmount: 0, settlementBalance: 0 });
  });

  it("入力額が今回請求分より多い場合は to 側 adjustment で過払い分を戻す", () => {
    const card = makeCard({
      id: "card-1",
      name: "Visa",
      settlementAccountId: "settle-1",
      closingDay: 15,
    });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-10",
      }),
    ];
    const built = buildCardSettlementTransactions({
      card,
      currentAmount: 3000,
      paidAmount: 3500,
      date: "2026-02-27",
    });

    expect(built.adjustment).toMatchObject({
      amount: 500,
      type: "adjustment",
      fromAccountId: null,
      toAccountId: "settle-1",
      cardId: null,
    });
    const result = deriveCardStatement(card, appendBuiltSettlement(txs, built), "2026-03-01");
    expect(result).toEqual({ currentAmount: 0, nextAmount: 0, settlementBalance: 0 });
  });

  it("正の整数円以外の入力額は保存用取引にしない", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1" });

    expect(() =>
      buildCardSettlementTransactions({
        card,
        currentAmount: 3000,
        paidAmount: 0,
        date: "2026-02-27",
      })
    ).toThrow("paidAmount must be a positive integer");
  });
});
