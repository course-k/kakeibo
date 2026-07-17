import { describe, expect, it } from "vitest";
import type { Account, Card, Transaction } from "@/domain/types";
import {
  amountFromText,
  buildExpenseTransactionInput,
  buildExpenseTransactionPatch,
  createEditingInputState,
  createInitialInputState,
  deriveExpenseEditPreview,
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

  it("定期取引由来の支出を編集しても recurringRuleId を保持する", () => {
    const original = tx({ recurringRuleId: "rule-monthly" });

    expect(
      buildExpenseTransactionPatch(
        {
          amountText: "1500",
          budgetAccountId: "budget-1",
          payment: { kind: "cash" },
          date: "2026-07-02",
          memo: "訂正後",
        },
        cards,
        original
      ).recurringRuleId
    ).toBe("rule-monthly");
  });

  it("定期取引由来の支出を別の月へ移動しない", () => {
    const original = tx({ date: "2026-07-05", recurringRuleId: "rule-monthly" });
    expect(() =>
      buildExpenseTransactionPatch(
        {
          amountText: "1500",
          budgetAccountId: "budget-1",
          payment: { kind: "cash" },
          date: "2026-06-30",
          memo: "前月へ移動",
        },
        cards,
        original
      )
    ).toThrow("毎月の自動記録は別の月へ移動できません");
  });

  it("支出入力画面では income や card_debit の編集状態を作らない", () => {
    const accounts = [account({ id: "budget-1" })];
    expect(() =>
      createEditingInputState(tx({ type: "income", fromAccountId: null, toAccountId: "budget-1" }), cards, accounts)
    ).toThrow("この記録は支出入力画面では編集できません");
    expect(() =>
      createEditingInputState(
        tx({ type: "card_debit", fromAccountId: "settlement-1", cardId: "card-1" }),
        cards,
        accounts
      )
    ).toThrow("この記録は支出入力画面では編集できません");
  });

  describe("支出編集 preview", () => {
    it("新規の現金支出は選択予算だけを減らす", () => {
      expect(
        deriveExpenseEditPreview(
          { "budget-1": 10_000 },
          tx({ amount: 1200 }),
          null
        )
      ).toEqual([
        {
          accountId: "budget-1",
          kind: "budget",
          before: 10_000,
          after: 8800,
          wasOriginal: false,
          isNext: true,
        },
      ]);
    });

    it("新規のカード支出は予算を減らしカード準備を増やす", () => {
      expect(
        deriveExpenseEditPreview(
          { "budget-1": 10_000, "settlement-1": 2000 },
          tx({
            amount: 1200,
            type: "expense_card",
            toAccountId: "settlement-1",
            cardId: "card-1",
          }),
          null
        ).map(({ accountId, before, after }) => ({ accountId, before, after }))
      ).toEqual([
        { accountId: "budget-1", before: 10_000, after: 8800 },
        { accountId: "settlement-1", before: 2000, after: 3200 },
      ]);
    });

    it("同じ予算の現金支出は旧額を戻して新額を引く", () => {
      const original = tx({ amount: 1000 });
      expect(
        deriveExpenseEditPreview(
          { "budget-1": 9000 },
          tx({ amount: 600 }),
          original
        )[0]
      ).toMatchObject({
        accountId: "budget-1",
        before: 9000,
        after: 9400,
        wasOriginal: true,
        isNext: true,
      });
    });

    it("予算を変更すると旧予算を戻して新予算から引く", () => {
      const preview = deriveExpenseEditPreview(
        { "budget-old": 4000, "budget-new": 8000 },
        tx({ amount: 1500, fromAccountId: "budget-new" }),
        tx({ amount: 1000, fromAccountId: "budget-old" })
      );
      expect(preview.map(({ accountId, before, after }) => ({ accountId, before, after }))).toEqual([
        { accountId: "budget-old", before: 4000, after: 5000 },
        { accountId: "budget-new", before: 8000, after: 6500 },
      ]);
    });

    it("同じカードの支出額変更は予算とカード準備の両方を差額更新する", () => {
      const original = tx({
        amount: 1000,
        type: "expense_card",
        toAccountId: "settlement-1",
        cardId: "card-1",
      });
      const preview = deriveExpenseEditPreview(
        { "budget-1": 9000, "settlement-1": 1000 },
        { ...original, amount: 1400 },
        original
      );
      expect(preview.map(({ accountId, before, after }) => ({ accountId, before, after }))).toEqual([
        { accountId: "budget-1", before: 9000, after: 8600 },
        { accountId: "settlement-1", before: 1000, after: 1400 },
      ]);
    });

    it("現金からカードへの変更は予算差額と新カード準備を反映する", () => {
      const preview = deriveExpenseEditPreview(
        { "budget-1": 9000, "settlement-1": 300 },
        tx({
          amount: 800,
          type: "expense_card",
          toAccountId: "settlement-1",
          cardId: "card-1",
        }),
        tx({ amount: 1000 })
      );
      expect(preview.map(({ accountId, before, after }) => ({ accountId, before, after }))).toEqual([
        { accountId: "budget-1", before: 9000, after: 9200 },
        { accountId: "settlement-1", before: 300, after: 1100 },
      ]);
    });

    it("カードから現金への変更は旧カード準備を戻して予算差額を反映する", () => {
      const original = tx({
        amount: 1000,
        type: "expense_card",
        toAccountId: "settlement-1",
        cardId: "card-1",
      });
      const preview = deriveExpenseEditPreview(
        { "budget-1": 9000, "settlement-1": 1000 },
        tx({ amount: 700, type: "expense_cash", toAccountId: null }),
        original
      );
      expect(preview.map(({ accountId, before, after }) => ({ accountId, before, after }))).toEqual([
        { accountId: "budget-1", before: 9000, after: 9300 },
        { accountId: "settlement-1", before: 1000, after: 0 },
      ]);
    });

    it("カード変更は旧カード準備を戻して新カード準備へ積む", () => {
      const original = tx({
        amount: 1000,
        type: "expense_card",
        toAccountId: "settlement-old",
        cardId: "card-old",
      });
      const preview = deriveExpenseEditPreview(
        { "budget-1": 9000, "settlement-old": 1000, "settlement-new": 300 },
        {
          ...original,
          amount: 700,
          toAccountId: "settlement-new",
        },
        original
      );
      expect(preview.map(({ accountId, before, after }) => ({ accountId, before, after }))).toEqual([
        { accountId: "budget-1", before: 9000, after: 9300 },
        { accountId: "settlement-old", before: 1000, after: 0 },
        { accountId: "settlement-new", before: 300, after: 1000 },
      ]);
    });

    it("未来の元支出は今日残高に未反映なのでpreviewで戻さない", () => {
      const preview = deriveExpenseEditPreview(
        { "budget-1": 9000, "settlement-1": 500 },
        tx({ date: "2026-07-18", amount: 600 }),
        tx({
          date: "2026-08-01",
          amount: 1000,
          type: "expense_card",
          toAccountId: "settlement-1",
          cardId: "card-1",
        }),
        "2026-07-18"
      );
      expect(preview.map(({ accountId, before, after }) => ({ accountId, before, after }))).toEqual([
        { accountId: "budget-1", before: 9000, after: 8400 },
      ]);
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
