import { describe, expect, it } from "vitest";
import { deriveCardStatement } from "./card-statement";
import { makeCard, makeTransaction } from "./test-fixtures";

describe("deriveCardStatement", () => {
  it("締め日未設定なら決済口座残高の全額を今回請求分（準備額）とする", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: null });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 4000,
        date: "2026-01-10",
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-01-20");
    expect(result).toEqual({ currentAmount: 4000, nextAmount: 0, settlementBalance: 4000 });
  });

  it("締め日設定時、締め日以前の支出は今回請求分、以降は次回以降分に分計する", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 15 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-10", // 締め日(15日)以前 -> 今回
      }),
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 2000,
        date: "2026-01-20", // 締め日以降 -> 次回
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-01-25");
    expect(result).toEqual({ currentAmount: 3000, nextAmount: 2000, settlementBalance: 5000 });
  });

  it("31日締め×30日月（4月）は月末(30日)に丸める", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 31 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 1000,
        date: "2026-04-30", // 4月末（丸められた締め日）以前 -> 今回
      }),
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 500,
        date: "2026-05-01", // 締め日翌日 -> 次回
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-05-05");
    expect(result.currentAmount).toBe(1000);
    expect(result.nextAmount).toBe(500);
  });

  it("31日締めで2月は28日（平年）に丸める", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 31 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 700,
        date: "2026-02-28", // 2月末（丸められた締め日）以前 -> 今回
      }),
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 300,
        date: "2026-03-01", // 次回
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-03-10");
    expect(result.currentAmount).toBe(700);
    expect(result.nextAmount).toBe(300);
  });

  it("月末締め（closingDay=31）でも today が締め日当日なら当日分まで今回に含める", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 31 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 900,
        date: "2026-04-30",
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-04-30");
    expect(result.currentAmount).toBe(900);
    expect(result.nextAmount).toBe(0);
  });

  it("引き落とし済み（card_debit 後）は今回請求分から減額される", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 15 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-10",
      }),
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 2000,
        date: "2026-01-20",
      }),
      makeTransaction({
        type: "card_debit",
        cardId: "card-1",
        fromAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-27",
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-02-01");
    // 今回請求分(3000)が引き落とし済み -> 0。次回以降分(2000)は据え置き。
    expect(result.currentAmount).toBe(0);
    expect(result.nextAmount).toBe(2000);
    expect(result.settlementBalance).toBe(2000);
  });

  it("論理削除された取引は請求分に現れない（不変条件 5）", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 15 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-10",
        deletedAt: "2026-01-11T00:00:00.000Z",
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-01-20");
    expect(result).toEqual({ currentAmount: 0, nextAmount: 0, settlementBalance: 0 });
  });

  it("決済口座に adjustment（初期残高）のみがある場合も今回請求分に反映される（Major-1 回帰）", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 15 });
    const txs = [
      makeTransaction({
        type: "adjustment",
        toAccountId: "settle-1",
        fromAccountId: null,
        amount: 5000,
        date: "2026-01-05",
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-01-20");
    expect(result).toEqual({ currentAmount: 5000, nextAmount: 0, settlementBalance: 5000 });
  });

  it("消し込み額と請求額の差額を adjustment で消し込むと今回請求分は 0 になる（消し込み・差額反映）", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 15 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-10", // 締め日以前 -> 今回請求分
      }),
      makeTransaction({
        type: "card_debit",
        cardId: "card-1",
        fromAccountId: "settle-1",
        amount: 2800, // 実際の引き落としは 2800（200 少ない）
        date: "2026-01-27",
      }),
      makeTransaction({
        type: "adjustment",
        fromAccountId: "settle-1",
        toAccountId: null,
        amount: 200, // 差額 200 を調整で消し込む
        date: "2026-01-28",
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-02-01");
    // settlementBalance = 3000(expense_card) - 2800(card_debit) - 200(adjustment) = 0
    // nextAmount = 0（締め日以降の expense_card なし）-> currentAmount = 0 - 0 = 0
    expect(result.settlementBalance).toBe(0);
    expect(result.nextAmount).toBe(0);
    expect(result.currentAmount).toBe(0);
  });

  it("過払い（card_debit が請求額を超える）の場合 currentAmount は負値のまま保持される（0 に丸めない）", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1", closingDay: 15 });
    const txs = [
      makeTransaction({
        type: "expense_card",
        cardId: "card-1",
        toAccountId: "settle-1",
        amount: 3000,
        date: "2026-01-10",
      }),
      makeTransaction({
        type: "card_debit",
        cardId: "card-1",
        fromAccountId: "settle-1",
        amount: 3500, // 請求額(3000)を超える過払い
        date: "2026-01-27",
      }),
    ];
    const result = deriveCardStatement(card, txs, "2026-02-01");
    expect(result.settlementBalance).toBe(-500);
    expect(result.nextAmount).toBe(0);
    expect(result.currentAmount).toBe(-500);
  });
});
