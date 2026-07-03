import { describe, expect, it } from "vitest";
import { insertAccount } from "../../db/accounts-repository";
import { insertCard } from "../../db/cards-repository";
import { createTestDb } from "../../db/test-utils";
import { insertTransaction, listTransactions } from "../../db/transactions-repository";
import { deriveCardStatement } from "../../domain";
import type { Card } from "../../domain/types";
import { makeCard } from "../../domain/test-fixtures";
import { buildCardSettlementTransactions } from "./settlement";

async function seedCard(db: ReturnType<typeof createTestDb>, closingDay: number | null = 15) {
  const budget = await insertAccount(db, {
    name: "生活費",
    type: "budget",
    monthlyBudget: 50000,
    ownerId: null,
    sortOrder: 0,
    archivedAt: null,
  });
  const settlement = await insertAccount(db, {
    name: "カード決済",
    type: "card_settlement",
    monthlyBudget: 0,
    ownerId: null,
    sortOrder: 1,
    archivedAt: null,
  });
  const card = await insertCard(db, {
    name: "Visa",
    settlementAccountId: settlement.id,
    closingDay,
    debitDay: 27,
  });
  return { budget, settlement, card };
}

async function insertCardExpense(
  db: ReturnType<typeof createTestDb>,
  input: {
    card: Card;
    budgetAccountId: string;
    amount: number;
    date: string;
  }
) {
  await insertTransaction(db, {
    date: input.date,
    amount: input.amount,
    type: "expense_card",
    fromAccountId: input.budgetAccountId,
    toAccountId: input.card.settlementAccountId,
    cardId: input.card.id,
    memo: "",
    recurringRuleId: null,
  });
}

async function settleAndDerive(
  db: ReturnType<typeof createTestDb>,
  input: { card: Card; paidAmount: number; date: string; today: string }
) {
  const tx = buildCardSettlementTransactions({
    card: input.card,
    paidAmount: input.paidAmount,
    date: input.date,
  });
  await insertTransaction(db, tx);
  return deriveCardStatement(input.card, await listTransactions(db), input.today);
}

describe("buildCardSettlementTransactions", () => {
  it("支払額を card_debit 1 件として組み立てる", () => {
    const card = makeCard({ id: "card-1", name: "Visa", settlementAccountId: "settle-1" });
    const built = buildCardSettlementTransactions({
      card,
      paidAmount: 3000,
      date: "2026-02-27",
    });

    expect(built).toEqual({
      date: "2026-02-27",
      amount: 3000,
      type: "card_debit",
      fromAccountId: "settle-1",
      toAccountId: null,
      cardId: "card-1",
      memo: "Visa 消し込み",
      recurringRuleId: null,
    });
  });

  it("今回請求分と同額の消し込み後は currentAmount が 0 になる", async () => {
    const db = createTestDb();
    const { budget, card } = await seedCard(db);
    await insertCardExpense(db, {
      card,
      budgetAccountId: budget.id,
      amount: 3000,
      date: "2026-01-10",
    });

    const result = await settleAndDerive(db, {
      card,
      paidAmount: 3000,
      date: "2026-01-27",
      today: "2026-02-01",
    });

    expect(result).toEqual({ currentAmount: 0, nextAmount: 0, settlementBalance: 0 });
  });

  it("今回請求分より少ない消し込み後は残債が currentAmount に残る", async () => {
    const db = createTestDb();
    const { budget, card } = await seedCard(db);
    await insertCardExpense(db, {
      card,
      budgetAccountId: budget.id,
      amount: 3000,
      date: "2026-01-10",
    });

    const result = await settleAndDerive(db, {
      card,
      paidAmount: 2800,
      date: "2026-01-27",
      today: "2026-02-01",
    });

    expect(result).toEqual({ currentAmount: 200, nextAmount: 0, settlementBalance: 200 });
  });

  it("今回請求分より多い消し込み後は currentAmount を負値のまま保持する", async () => {
    const db = createTestDb();
    const { budget, card } = await seedCard(db);
    await insertCardExpense(db, {
      card,
      budgetAccountId: budget.id,
      amount: 3000,
      date: "2026-01-10",
    });

    const result = await settleAndDerive(db, {
      card,
      paidAmount: 3500,
      date: "2026-01-27",
      today: "2026-02-01",
    });

    expect(result).toEqual({ currentAmount: -500, nextAmount: 0, settlementBalance: -500 });
  });

  it.each([
    {
      name: "4月末",
      currentDate: "2026-04-30",
      nextDate: "2026-05-01",
      paidDate: "2026-04-30",
      today: "2026-05-05",
    },
    {
      name: "2月末",
      currentDate: "2026-02-28",
      nextDate: "2026-03-01",
      paidDate: "2026-02-28",
      today: "2026-03-10",
    },
  ])("closingDay=31 の $name 境界でも消し込み後の今回/次回分を分計する", async ({
    currentDate,
    nextDate,
    paidDate,
    today,
  }) => {
    const db = createTestDb();
    const { budget, card } = await seedCard(db, 31);
    await insertCardExpense(db, {
      card,
      budgetAccountId: budget.id,
      amount: 1000,
      date: currentDate,
    });
    await insertCardExpense(db, {
      card,
      budgetAccountId: budget.id,
      amount: 400,
      date: nextDate,
    });

    const result = await settleAndDerive(db, {
      card,
      paidAmount: 600,
      date: paidDate,
      today,
    });

    expect(result).toEqual({ currentAmount: 400, nextAmount: 400, settlementBalance: 800 });
  });

  it("正の整数円以外の入力額は保存用取引にしない", () => {
    const card = makeCard({ id: "card-1", settlementAccountId: "settle-1" });

    expect(() =>
      buildCardSettlementTransactions({
        card,
        paidAmount: 0,
        date: "2026-02-27",
      })
    ).toThrow("paidAmount must be a positive integer");
  });
});
