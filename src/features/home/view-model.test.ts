import { describe, expect, it } from "vitest";

import { deriveBalance } from "../../domain/balance";
import { deriveCardStatement } from "../../domain/card-statement";
import { deriveSavings } from "../../domain/savings";
import { makeAccount, makeCard, makeTransaction } from "../../domain/test-fixtures";

import { buildHomeViewModel } from "./view-model";

describe("buildHomeViewModel", () => {
  it("予算口座残額・カード準備額・貯まり合計がドメイン導出値と一致する", () => {
    const food = makeAccount({ id: "budget-food", name: "食費", sortOrder: 1 });
    const fun = makeAccount({ id: "budget-fun", name: "娯楽", sortOrder: 2 });
    const archived = makeAccount({
      id: "budget-archived",
      name: "旧予算",
      archivedAt: "2026-01-01",
      sortOrder: 3,
    });
    const settlement = makeAccount({
      id: "settlement-visa",
      name: "Visa 決済",
      type: "card_settlement",
      sortOrder: 4,
    });
    const card = makeCard({
      id: "card-visa",
      name: "Visa",
      settlementAccountId: settlement.id,
      closingDay: 15,
      debitDay: 27,
    });
    const transactions = [
      makeTransaction({
        id: "income-food",
        amount: 50_000,
        type: "income",
        toAccountId: food.id,
      }),
      makeTransaction({
        id: "cash-food",
        amount: 1_200,
        type: "expense_cash",
        fromAccountId: food.id,
      }),
      makeTransaction({
        id: "card-food-current",
        date: "2026-06-10",
        amount: 3_000,
        type: "expense_card",
        fromAccountId: food.id,
        toAccountId: settlement.id,
        cardId: card.id,
      }),
      makeTransaction({
        id: "income-fun",
        amount: 20_000,
        type: "income",
        toAccountId: fun.id,
      }),
      makeTransaction({
        id: "card-fun-next",
        date: "2026-06-20",
        amount: 2_000,
        type: "expense_card",
        fromAccountId: fun.id,
        toAccountId: settlement.id,
        cardId: card.id,
      }),
      makeTransaction({
        id: "income-archived",
        amount: 99_999,
        type: "income",
        toAccountId: archived.id,
      }),
    ];

    const activeBudgetAccounts = [food, fun];
    const model = buildHomeViewModel(
      [food, fun, archived, settlement],
      [card],
      transactions,
      "2026-06-20"
    );

    expect(model.budgetAccounts).toEqual([
      {
        id: food.id,
        name: food.name,
        remainingAmount: deriveBalance(food.id, transactions),
      },
      {
        id: fun.id,
        name: fun.name,
        remainingAmount: deriveBalance(fun.id, transactions),
      },
    ]);
    expect(model.cards).toEqual([
      {
        id: card.id,
        name: card.name,
        debitDay: card.debitDay,
        preparedAmount: deriveCardStatement(card, transactions, "2026-06-20").currentAmount,
        needsAttention: false,
      },
    ]);
    expect(model.savingsAmount).toBe(deriveSavings(activeBudgetAccounts, transactions));
  });

  it("負の currentAmount を丸めず、警告フラグを立てる", () => {
    const budget = makeAccount({ id: "budget-main", name: "生活費" });
    const settlement = makeAccount({
      id: "settlement-master",
      name: "Master 決済",
      type: "card_settlement",
      sortOrder: 1,
    });
    const card = makeCard({
      id: "card-master",
      settlementAccountId: settlement.id,
      closingDay: null,
      debitDay: 10,
    });
    const transactions = [
      makeTransaction({
        id: "overpaid",
        amount: 1_500,
        type: "card_debit",
        fromAccountId: settlement.id,
        cardId: card.id,
      }),
    ];

    const model = buildHomeViewModel([budget, settlement], [card], transactions, "2026-06-20");
    const statement = deriveCardStatement(card, transactions, "2026-06-20");

    expect(statement.currentAmount).toBe(-1_500);
    expect(model.cards[0]).toMatchObject({
      preparedAmount: statement.currentAmount,
      needsAttention: true,
    });
  });
});
