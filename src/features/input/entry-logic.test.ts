import { describe, expect, it } from "vitest";

import type { Card } from "../../domain/types";
import {
  buildEntryRecurringRuleInput,
  buildEntryTransactionInput,
  changeEntryKind,
  createEntryState,
  type EntryFormState,
} from "./entry-logic";

const cards: Card[] = [{
  id: "visa",
  name: "Visa",
  settlementAccountId: "card-settlement",
  closingDay: null,
  debitDay: 27,
}];

function state(patch: Partial<EntryFormState>): EntryFormState {
  return {
    ...createEntryState("expense", "2026-07-18"),
    amountText: "1200",
    ...patch,
  };
}

describe("entry-logic", () => {
  it("収入をカテゴリ付きで予算へ記録する", () => {
    expect(buildEntryTransactionInput(state({
      kind: "income",
      toAccountId: "budget-main",
      categoryId: "salary",
    }), cards)).toMatchObject({
      type: "income",
      amount: 1200,
      fromAccountId: null,
      toAccountId: "budget-main",
      categoryId: "salary",
    });
  });

  it("現金・カード支出と振替を別の会計取引へ変換する", () => {
    expect(buildEntryTransactionInput(state({
      fromAccountId: "budget-food",
      categoryId: "eating-out",
      payment: { kind: "card", cardId: "visa" },
    }), cards)).toMatchObject({
      type: "expense_card",
      toAccountId: "card-settlement",
      cardId: "visa",
    });
    expect(buildEntryTransactionInput(state({
      kind: "transfer",
      fromAccountId: "budget-food",
      toAccountId: "budget-daily",
    }), cards)).toMatchObject({
      type: "transfer",
      categoryId: null,
    });
  });

  it("収入・支出ではカテゴリを必須にし、種別変更時は古い選択を消す", () => {
    expect(() => buildEntryTransactionInput(state({ fromAccountId: "budget-food" }), cards))
      .toThrow("支出カテゴリを選択してください");
    const changed = changeEntryKind(state({
      categoryId: "old",
      fromAccountId: "from",
      toAccountId: "to",
      payment: { kind: "card", cardId: "visa" },
    }), "income");
    expect(changed).toMatchObject({
      kind: "income",
      categoryId: null,
      fromAccountId: null,
      toAccountId: null,
      payment: { kind: "cash" },
    });
  });

  it("一般の定期記録を予算充当と区別して保存する", () => {
    expect(buildEntryRecurringRuleInput(state({
      kind: "income",
      toAccountId: "budget-main",
      categoryId: "salary",
      dayOfMonth: "25",
    }), cards)).toMatchObject({
      ruleKind: "user",
      type: "income",
      dayOfMonth: 25,
      categoryId: "salary",
    });
  });
});
