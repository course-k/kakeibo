import { describe, expect, it } from "vitest";
import { deriveSavings } from "./savings";
import { makeAccount, makeTransaction } from "./test-fixtures";

describe("deriveSavings", () => {
  it("全 budget 口座残高の合計を返す", () => {
    const accounts = [
      makeAccount({ id: "b1", type: "budget" }),
      makeAccount({ id: "b2", type: "budget" }),
      makeAccount({ id: "s1", type: "card_settlement" }),
    ];
    const txs = [
      makeTransaction({ type: "income", toAccountId: "b1", amount: 10000 }),
      makeTransaction({ type: "income", toAccountId: "b2", amount: 5000 }),
      makeTransaction({ type: "expense_card", fromAccountId: "b1", toAccountId: "s1", amount: 3000 }),
    ];
    // b1: 10000 - 3000 = 7000, b2: 5000, s1(card_settlement は含まない)
    expect(deriveSavings(accounts, txs)).toBe(12000);
  });

  it("論理削除された取引は貯まりに現れない（不変条件 5）", () => {
    const accounts = [makeAccount({ id: "b1", type: "budget" })];
    const txs = [
      makeTransaction({ type: "income", toAccountId: "b1", amount: 10000 }),
      makeTransaction({
        type: "income",
        toAccountId: "b1",
        amount: 99999,
        deletedAt: "2026-01-02T00:00:00.000Z",
      }),
    ];
    expect(deriveSavings(accounts, txs)).toBe(10000);
  });

  it("budget 口座がなければ 0", () => {
    expect(deriveSavings([], [])).toBe(0);
  });
});
