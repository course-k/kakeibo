// spec §2.3 の不変条件 1〜5 を明示的に検証する。
// 不変条件 6（エクスポート/インポートの往復一致）は M2 スコープのため対象外。
import { describe, expect, it } from "vitest";
import { isValidAmount } from "./amount";
import { validateTransaction } from "./validate-transaction";
import { deriveAllBalances, deriveBalance } from "./balance";
import { makeAccount, makeTransaction } from "./test-fixtures";
import type { Account, Transaction } from "./types";

describe("不変条件 1: 金額は常に正の整数円。ゼロ・負・小数は取引として保存不可", () => {
  it("正の整数のみ妥当と判定する", () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(1.5)).toBe(false);
  });

  it("validateTransaction も不正な金額の取引を拒否する", () => {
    const budget = makeAccount({ id: "budget-1", type: "budget" });
    const result = validateTransaction(
      { amount: 0, type: "income", fromAccountId: null, toAccountId: budget.id },
      [budget]
    );
    expect(result.ok).toBe(false);
  });
});

describe("不変条件 2: type ごとの from/to 必須制約に反する取引は保存不可", () => {
  const budget = makeAccount({ id: "budget-1", type: "budget" });
  const settlement = makeAccount({ id: "settlement-1", type: "card_settlement" });
  const accounts: Account[] = [budget, settlement];

  it.each([
    ["income", null, "budget-1", true],
    ["income", "budget-1", "budget-1", false],
    ["expense_cash", "budget-1", null, true],
    ["expense_cash", null, null, false],
    ["expense_card", "budget-1", "settlement-1", true],
    ["expense_card", "budget-1", "budget-1", false],
    ["card_debit", "settlement-1", null, true],
    ["card_debit", "budget-1", null, false],
  ] as const)("%s (from=%s, to=%s) -> ok=%s", (type, fromAccountId, toAccountId, expected) => {
    const result = validateTransaction({ amount: 100, type, fromAccountId, toAccountId }, accounts);
    expect(result.ok).toBe(expected);
  });
});

describe("不変条件 3: どの時点でも「口座残高 = 取引集計」が一致する", () => {
  it("残高キャッシュを持たず、都度取引集計から導出される", () => {
    const budget = makeAccount({ id: "budget-1", type: "budget" });
    let txs: Transaction[] = [
      makeTransaction({ type: "income", toAccountId: "budget-1", amount: 10000 }),
    ];
    expect(deriveBalance("budget-1", txs)).toBe(10000);

    // 取引を追加しても、保存されたキャッシュ値ではなく都度再集計される
    txs = [...txs, makeTransaction({ type: "expense_cash", fromAccountId: "budget-1", amount: 3000 })];
    expect(deriveBalance("budget-1", txs)).toBe(7000);

    // deriveAllBalances も同じ集計ロジックで一致する
    expect(deriveAllBalances([budget], txs)).toEqual({ "budget-1": 7000 });
  });
});

describe("不変条件 4: expense_card の削除・編集は 2 口座の動きが原子的に消える/変わる", () => {
  it("expense_card は 1 レコードが from/to 両方を保持するため、削除すると両口座の影響が同時に消える", () => {
    const budget = makeAccount({ id: "budget-1", type: "budget" });
    const settlement = makeAccount({ id: "settlement-1", type: "card_settlement" });
    const expenseCard = makeTransaction({
      type: "expense_card",
      fromAccountId: "budget-1",
      toAccountId: "settlement-1",
      amount: 3000,
    });

    const before = deriveAllBalances([budget, settlement], [expenseCard]);
    expect(before).toEqual({ "budget-1": -3000, "settlement-1": 3000 });

    // 論理削除（片側だけを消すことはできない。1 レコードの deletedAt を立てるだけで両側が消える）
    const deleted = { ...expenseCard, deletedAt: "2026-01-05T00:00:00.000Z" };
    const after = deriveAllBalances([budget, settlement], [deleted]);
    expect(after).toEqual({ "budget-1": 0, "settlement-1": 0 });
  });

  it("編集（金額変更）も 1 レコードの更新のため、2 口座の影響が同時に変わる", () => {
    const budget = makeAccount({ id: "budget-1", type: "budget" });
    const settlement = makeAccount({ id: "settlement-1", type: "card_settlement" });
    const original = makeTransaction({
      type: "expense_card",
      fromAccountId: "budget-1",
      toAccountId: "settlement-1",
      amount: 3000,
    });
    const edited = { ...original, amount: 5000 };

    const after = deriveAllBalances([budget, settlement], [edited]);
    expect(after).toEqual({ "budget-1": -5000, "settlement-1": 5000 });
  });
});

describe("不変条件 5: 論理削除された取引は残高・集計・エクスポートに一切現れない", () => {
  it("deriveBalance / deriveAllBalances から除外される", () => {
    const budget = makeAccount({ id: "budget-1", type: "budget" });
    const txs = [
      makeTransaction({ type: "income", toAccountId: "budget-1", amount: 10000 }),
      makeTransaction({
        type: "income",
        toAccountId: "budget-1",
        amount: 99999,
        deletedAt: "2026-01-02T00:00:00.000Z",
      }),
    ];
    expect(deriveBalance("budget-1", txs)).toBe(10000);
    expect(deriveAllBalances([budget], txs)).toEqual({ "budget-1": 10000 });
  });
});
