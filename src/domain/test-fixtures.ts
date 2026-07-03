// テスト用の最小フィクスチャ生成ヘルパー。プロダクションコードからは参照しない。
import type { Account, Card, Transaction } from "./types";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: nextId("acc"),
    name: "口座",
    type: "budget",
    monthlyBudget: 0,
    ownerId: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: nextId("card"),
    name: "カード",
    settlementAccountId: nextId("acc"),
    closingDay: null,
    debitDay: 27,
    ...overrides,
  };
}

export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId("tx"),
    date: "2026-01-01",
    amount: 1000,
    type: "income",
    fromAccountId: null,
    toAccountId: null,
    cardId: null,
    memo: "",
    recurringRuleId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
