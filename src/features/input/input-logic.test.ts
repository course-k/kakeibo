import { describe, expect, it } from "vitest";
import type { Account, Card, Transaction } from "@/domain/types";
import {
  amountFromText,
  buildExpenseTransactionInput,
  createEditingInputState,
  createInitialInputState,
  deriveLastInputDefaults,
  selectInputBudgetAccounts,
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

function account(overrides: Partial<Account> & Pick<Account, "id">): Account {
  return {
    name: overrides.id,
    type: "budget",
    monthlyBudget: 0,
    ownerId: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

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
  it("過去支出の編集では利用元の終了済み予算だけを候補に残して保持する", () => {
    const active = account({ id: "budget-active" });
    const archivedSource = account({ id: "budget-old", archivedAt: "2026-07-01" });
    const unrelatedArchived = account({ id: "budget-other", archivedAt: "2026-06-01" });
    const settlement = account({ id: "settlement", type: "card_settlement" });
    const transaction = tx({ fromAccountId: archivedSource.id });

    expect(
      selectInputBudgetAccounts(
        [active, archivedSource, unrelatedArchived, settlement],
        transaction.fromAccountId
      ).map((item) => item.id)
    ).toEqual([active.id, archivedSource.id]);
    expect(createEditingInputState(transaction, cards, [active, archivedSource]).budgetAccountId).toBe(
      archivedSource.id
    );
  });

  it("編集元の予算が欠損している場合は別予算へ付け替えない", () => {
    expect(() =>
      createEditingInputState(tx({ fromAccountId: "missing" }), cards, [
        account({ id: "budget-active" }),
      ])
    ).toThrow("この支出に紐づく予算が見つかりません");
  });

  it("新規入力では終了済み予算を候補に含めない", () => {
    expect(
      selectInputBudgetAccounts(
        [account({ id: "active" }), account({ id: "archived", archivedAt: "2026-07-01" })],
        null
      ).map((item) => item.id)
    ).toEqual(["active"]);
  });

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

  it("過去日の後入力でも、操作順で前回デフォルトを導く", () => {
    const defaults = deriveLastInputDefaults(
      [
        tx({
          id: "newer-date",
          date: "2026-07-10",
          fromAccountId: "budget-old-operation",
          createdAt: "2026-07-10T01:00:00.000Z",
        }),
        tx({
          id: "later-operation",
          date: "2026-07-01",
          fromAccountId: "budget-last-used",
          createdAt: "2026-07-11T01:00:00.000Z",
        }),
      ],
      cards
    );

    expect(defaults.budgetAccountId).toBe("budget-last-used");
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
