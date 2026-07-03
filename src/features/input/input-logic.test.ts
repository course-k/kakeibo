import { describe, expect, it } from "vitest";
import type { Card, Transaction } from "@/domain/types";
import {
  amountFromText,
  buildExpenseTransactionInput,
  createInitialInputState,
  deriveLastInputDefaults,
  todayIsoDate,
} from "./input-logic";

const cards: Card[] = [
  {
    id: "card-1",
    name: "Visa",
    settlementAccountId: "settlement-1",
    closingDay: null,
    debitDay: 27,
  },
];

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "tx-1",
    date: "2026-07-01",
    amount: 1000,
    type: "expense_cash",
    fromAccountId: "budget-1",
    toAccountId: null,
    cardId: null,
    memo: "",
    recurringRuleId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("input logic", () => {
  it("今日の日付を YYYY-MM-DD で作る", () => {
    expect(todayIsoDate(new Date(2026, 6, 3))).toBe("2026-07-03");
  });

  it("初期状態の日付は渡された今日になる", () => {
    const state = createInitialInputState(
      { budgetAccountId: "budget-1", payment: { kind: "cash" } },
      "2026-07-03"
    );

    expect(state.date).toBe("2026-07-03");
  });

  it("正整数の金額だけを受け付ける", () => {
    expect(amountFromText("1")).toBe(1);
    expect(amountFromText("1200")).toBe(1200);
    expect(amountFromText("0")).toBeNull();
    expect(amountFromText("-1")).toBeNull();
    expect(amountFromText("10.5")).toBeNull();
    expect(amountFromText("")).toBeNull();
  });

  it("expense_cash は budget から外部への支出として組み立てる", () => {
    const input = buildExpenseTransactionInput(
      {
        amountText: "1200",
        budgetAccountId: "budget-food",
        payment: { kind: "cash" },
        date: "2026-07-03",
        memo: "lunch",
      },
      cards
    );

    expect(input).toEqual({
      date: "2026-07-03",
      amount: 1200,
      type: "expense_cash",
      fromAccountId: "budget-food",
      toAccountId: null,
      cardId: null,
      memo: "lunch",
      recurringRuleId: null,
    });
  });

  it("expense_card は budget からカード決済口座への2口座移動として組み立てる", () => {
    const input = buildExpenseTransactionInput(
      {
        amountText: "3400",
        budgetAccountId: "budget-food",
        payment: { kind: "card", cardId: "card-1" },
        date: "2026-07-03",
        memo: "",
      },
      cards
    );

    expect(input).toMatchObject({
      amount: 3400,
      type: "expense_card",
      fromAccountId: "budget-food",
      toAccountId: "settlement-1",
      cardId: "card-1",
    });
  });

  it("直近の現金支出から前回デフォルトを導く", () => {
    const defaults = deriveLastInputDefaults(
      [
        tx({ id: "old", date: "2026-07-01", fromAccountId: "budget-old" }),
        tx({ id: "new", date: "2026-07-02", fromAccountId: "budget-new" }),
      ],
      cards
    );

    expect(defaults).toEqual({
      budgetAccountId: "budget-new",
      payment: { kind: "cash" },
    });
  });

  it("直近のカード支出から前回カードを導く", () => {
    const defaults = deriveLastInputDefaults(
      [
        tx({ id: "cash", date: "2026-07-02", type: "expense_cash", cardId: null }),
        tx({
          id: "card",
          date: "2026-07-03",
          type: "expense_card",
          fromAccountId: "budget-card",
          toAccountId: "settlement-1",
          cardId: "card-1",
        }),
      ],
      cards
    );

    expect(defaults).toEqual({
      budgetAccountId: "budget-card",
      payment: { kind: "card", cardId: "card-1" },
    });
  });
});
