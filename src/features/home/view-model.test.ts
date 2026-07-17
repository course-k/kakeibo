import { describe, expect, it } from "vitest";

import { deriveBalance } from "../../domain/balance";
import { deriveCardPreparedAmount } from "../../domain/card-statement";
import { deriveSavings } from "../../domain/savings";
import { makeAccount, makeCard, makeTransaction } from "../../domain/test-fixtures";

import { buildHomeViewModel, buildTransactionHistoryItems } from "./view-model";

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
        preparedAmount: deriveCardPreparedAmount(card, transactions, "2026-06-20"),
        needsAttention: false,
      },
    ]);
    expect(model.savingsAmount).toBe(deriveSavings(activeBudgetAccounts, transactions));
  });

  it("負の支払準備総額を丸めず、警告フラグを立てる", () => {
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
    const preparedAmount = deriveCardPreparedAmount(card, transactions, "2026-06-20");

    expect(preparedAmount).toBe(-1_500);
    expect(model.cards[0]).toMatchObject({
      preparedAmount,
      needsAttention: true,
    });
  });

  it("締め越しでもホームに今回分・次回分を作らない", () => {
    const budget = makeAccount({ id: "budget-main", name: "生活費" });
    const settlement = makeAccount({
      id: "settlement-visa",
      name: "Visa 決済",
      type: "card_settlement",
    });
    const card = makeCard({
      id: "card-visa",
      settlementAccountId: settlement.id,
      closingDay: 15,
      debitDay: 27,
    });
    const transactions = [
      makeTransaction({
        date: "2026-01-10",
        amount: 10_000,
        type: "expense_card",
        fromAccountId: budget.id,
        toAccountId: settlement.id,
        cardId: card.id,
      }),
      makeTransaction({
        date: "2026-02-10",
        amount: 20_000,
        type: "expense_card",
        fromAccountId: budget.id,
        toAccountId: settlement.id,
        cardId: card.id,
      }),
    ];

    const model = buildHomeViewModel(
      [budget, settlement],
      [card],
      transactions,
      "2026-02-16"
    );

    expect(model.cards[0]).toEqual({
      id: card.id,
      name: card.name,
      debitDay: card.debitDay,
      preparedAmount: 30_000,
      needsAttention: false,
    });
    expect(model.cards[0]).not.toHaveProperty("currentAmount");
    expect(model.cards[0]).not.toHaveProperty("nextAmount");
  });

  it("ホームの直近履歴を取引日の新しい順で5件に絞る", () => {
    const budget = makeAccount({ id: "budget-main", name: "生活費" });
    const transactions = Array.from({ length: 6 }, (_, index) =>
      makeTransaction({
        id: `expense-${index + 1}`,
        date: `2026-06-${String(index + 1).padStart(2, "0")}`,
        type: "expense_cash",
        fromAccountId: budget.id,
      })
    );

    const model = buildHomeViewModel([budget], [], transactions, "2026-06-20");

    expect(model.recentTransactions.map((item) => item.id)).toEqual([
      "expense-6",
      "expense-5",
      "expense-4",
      "expense-3",
      "expense-2",
    ]);
  });
});

describe("buildTransactionHistoryItems", () => {
  it("全取引を日本語の種別・口座名・金額方向へ変換する", () => {
    const food = makeAccount({ id: "budget-food", name: "食費" });
    const fun = makeAccount({ id: "budget-fun", name: "娯楽費" });
    const settlement = makeAccount({
      id: "settlement-visa",
      name: "Visa 支払い準備",
      type: "card_settlement",
    });
    const card = makeCard({
      id: "card-visa",
      name: "Visa",
      settlementAccountId: settlement.id,
    });
    const transactions = [
      makeTransaction({
        id: "income",
        date: "2026-06-01",
        type: "income",
        toAccountId: food.id,
      }),
      makeTransaction({
        id: "cash",
        date: "2026-06-02",
        type: "expense_cash",
        fromAccountId: food.id,
      }),
      makeTransaction({
        id: "card",
        date: "2026-06-03",
        type: "expense_card",
        fromAccountId: food.id,
        toAccountId: settlement.id,
        cardId: card.id,
      }),
      makeTransaction({
        id: "transfer",
        date: "2026-06-04",
        type: "transfer",
        fromAccountId: food.id,
        toAccountId: fun.id,
      }),
      makeTransaction({
        id: "debit",
        date: "2026-06-05",
        type: "card_debit",
        fromAccountId: settlement.id,
        cardId: card.id,
      }),
      makeTransaction({
        id: "adjustment",
        date: "2026-06-06",
        type: "adjustment",
        toAccountId: food.id,
      }),
    ];

    const items = buildTransactionHistoryItems(
      [food, fun, settlement],
      [card],
      transactions
    );

    expect(items).toMatchObject([
      {
        id: "adjustment",
        typeLabel: "残高を合わせる",
        accountLabel: "食費",
        amountDirection: "in",
        editable: true,
      },
      {
        id: "debit",
        typeLabel: "カード引き落とし",
        accountLabel: "Visa",
        amountDirection: "out",
        editable: true,
      },
      {
        id: "transfer",
        typeLabel: "予算を移す",
        accountLabel: "食費 → 娯楽費",
        amountDirection: "neutral",
        editable: true,
      },
      {
        id: "card",
        typeLabel: "カード利用",
        accountLabel: "食費 / Visa",
        amountDirection: "out",
        editable: true,
      },
      {
        id: "cash",
        typeLabel: "現金・即時払い",
        accountLabel: "食費",
        amountDirection: "out",
        editable: true,
      },
      {
        id: "income",
        typeLabel: "予算を追加",
        accountLabel: "食費",
        amountDirection: "in",
        editable: true,
      },
    ]);
  });
});
