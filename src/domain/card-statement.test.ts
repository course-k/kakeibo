import { describe, expect, it } from "vitest";
import {
  deriveCardPreparedAmount,
  deriveCardPreparedChange,
  isCardPreparedTransaction,
} from "./card-statement";
import { makeCard, makeTransaction } from "./test-fixtures";

describe("deriveCardPreparedAmount", () => {
  it("カード利用の合計を支払準備総額として導出する", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1" });
    const transactions = [
      makeTransaction({
        type: "expense_card",
        cardId: card.id,
        toAccountId: card.settlementAccountId,
        amount: 3_000,
        date: "2026-01-10",
      }),
      makeTransaction({
        type: "expense_card",
        cardId: card.id,
        toAccountId: card.settlementAccountId,
        amount: 2_000,
        date: "2026-01-20",
      }),
    ];

    expect(deriveCardPreparedAmount(card, transactions, "2026-01-25")).toBe(5_000);
  });

  it("締め越しでも請求周期を推定せず支払準備総額だけを返す", () => {
    const card = makeCard({
      id: "card-1",
      settlementAccountId: "settle-1",
      closingDay: 15,
      debitDay: 27,
    });
    const transactions = [
      makeTransaction({
        type: "expense_card",
        cardId: card.id,
        toAccountId: card.settlementAccountId,
        amount: 10_000,
        date: "2026-01-10",
      }),
      makeTransaction({
        type: "expense_card",
        cardId: card.id,
        toAccountId: card.settlementAccountId,
        amount: 20_000,
        date: "2026-02-10",
      }),
    ];

    // 2/16 時点で 2/27 と 3/27 の請求対象が混在しても、誤った「今回分」を作らない。
    expect(deriveCardPreparedAmount(card, transactions, "2026-02-16")).toBe(30_000);
  });

  it("実際の引き落としを記録すると支払準備総額から減る", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1" });
    const transactions = [
      makeTransaction({
        type: "expense_card",
        cardId: card.id,
        toAccountId: card.settlementAccountId,
        amount: 3_000,
        date: "2026-01-10",
      }),
      makeTransaction({
        type: "card_debit",
        cardId: card.id,
        fromAccountId: card.settlementAccountId,
        amount: 2_800,
        date: "2026-02-27",
      }),
    ];

    expect(deriveCardPreparedAmount(card, transactions, "2026-02-27")).toBe(200);
  });

  it("adjustment を反映し、過払いの負値も丸めない", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1" });
    const transactions = [
      makeTransaction({
        type: "adjustment",
        toAccountId: card.settlementAccountId,
        amount: 3_000,
        date: "2026-01-10",
      }),
      makeTransaction({
        type: "card_debit",
        cardId: card.id,
        fromAccountId: card.settlementAccountId,
        amount: 3_500,
        date: "2026-01-27",
      }),
    ];

    expect(deriveCardPreparedAmount(card, transactions, "2026-01-27")).toBe(-500);
  });

  it("論理削除済みと未来日の取引を今日の支払準備に含めない", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1" });
    const transactions = [
      makeTransaction({
        type: "expense_card",
        cardId: card.id,
        toAccountId: card.settlementAccountId,
        amount: 3_000,
        date: "2026-07-10",
        deletedAt: "2026-07-11T00:00:00.000Z",
      }),
      makeTransaction({
        type: "expense_card",
        cardId: card.id,
        toAccountId: card.settlementAccountId,
        amount: 4_000,
        date: "2026-08-01",
      }),
    ];

    expect(deriveCardPreparedAmount(card, transactions, "2026-07-17")).toBe(0);
  });
});

describe("card prepared history", () => {
  const card = makeCard({ id: "card-1", settlementAccountId: "settle-1" });

  it("入金adjustmentは正、減額adjustmentと引き落としは負で表示する", () => {
    expect(
      deriveCardPreparedChange(
        card,
        makeTransaction({ type: "adjustment", toAccountId: "settle-1", amount: 500 })
      )
    ).toBe(500);
    expect(
      deriveCardPreparedChange(
        card,
        makeTransaction({ type: "adjustment", fromAccountId: "settle-1", amount: 300 })
      )
    ).toBe(-300);
    expect(
      deriveCardPreparedChange(
        card,
        makeTransaction({ type: "card_debit", fromAccountId: "settle-1", amount: 200 })
      )
    ).toBe(-200);
  });

  it("cardId導入前の決済口座adjustmentも対応カードの履歴へ含める", () => {
    const legacy = makeTransaction({
      type: "adjustment",
      cardId: null,
      toAccountId: "settle-1",
    });
    const unrelated = makeTransaction({
      type: "adjustment",
      cardId: null,
      toAccountId: "other-settlement",
    });
    expect(isCardPreparedTransaction(card, legacy)).toBe(true);
    expect(isCardPreparedTransaction(card, unrelated)).toBe(false);
  });
});
