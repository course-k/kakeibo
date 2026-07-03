import { describe, expect, it } from "vitest";
import { deriveAllBalances, deriveBalance } from "./balance";
import { makeAccount, makeTransaction } from "./test-fixtures";

describe("deriveBalance", () => {
  it("to への取引を加算し from からの取引を減算する", () => {
    const txs = [
      makeTransaction({ type: "income", toAccountId: "a", amount: 5000 }),
      makeTransaction({ type: "expense_cash", fromAccountId: "a", amount: 2000 }),
    ];
    expect(deriveBalance("a", txs)).toBe(3000);
  });

  it("関係ない口座の取引は無視する", () => {
    const txs = [makeTransaction({ type: "income", toAccountId: "b", amount: 5000 })];
    expect(deriveBalance("a", txs)).toBe(0);
  });

  it("論理削除された取引は集計から除外する（不変条件 5）", () => {
    const txs = [
      makeTransaction({ type: "income", toAccountId: "a", amount: 5000 }),
      makeTransaction({ type: "income", toAccountId: "a", amount: 1000, deletedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    expect(deriveBalance("a", txs)).toBe(5000);
  });

  it("取引がなければ 0", () => {
    expect(deriveBalance("a", [])).toBe(0);
  });
});

describe("deriveAllBalances", () => {
  it("全口座分の残高をまとめて返す", () => {
    const accounts = [makeAccount({ id: "a" }), makeAccount({ id: "b" })];
    const txs = [
      makeTransaction({ type: "income", toAccountId: "a", amount: 1000 }),
      makeTransaction({ type: "income", toAccountId: "b", amount: 2000 }),
    ];
    expect(deriveAllBalances(accounts, txs)).toEqual({ a: 1000, b: 2000 });
  });
});
