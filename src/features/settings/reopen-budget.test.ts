import { describe, expect, it } from "vitest";

import { getAccountById, insertAccount } from "../../db/accounts-repository";
import {
  insertRecurringRule,
  listRecurringRules,
} from "../../db/recurring-rules-repository";
import { createTestDb } from "../../db/test-utils";
import { reopenBudget } from "./reopen-budget";

describe("reopenBudget", () => {
  it("終了済み予算を毎月0円のまま再開する", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-food",
      name: "食費",
      type: "budget",
      monthlyBudget: 50_000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: "2026-07-01",
    });
    await insertRecurringRule(db, {
      id: "legacy-rule",
      type: "income",
      amount: 50_000,
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "旧版に残った自動充当",
      dayOfMonth: 1,
    });

    const reopened = await reopenBudget(db, account.id);

    expect(reopened).toMatchObject({
      id: account.id,
      type: "budget",
      archivedAt: null,
      monthlyBudget: 0,
    });
    expect(await getAccountById(db, account.id)).toMatchObject({
      archivedAt: null,
      monthlyBudget: 0,
    });
    expect(await listRecurringRules(db)).toEqual([]);
  });

  it("存在しない口座は再開しない", async () => {
    const db = createTestDb();

    await expect(reopenBudget(db, "missing-budget")).rejects.toThrow(
      "account not found: missing-budget"
    );
  });

  it("カード支払準備口座は再開しない", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "settlement-card",
      name: "カード支払準備",
      type: "card_settlement",
      monthlyBudget: 30_000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: "2026-07-01",
    });

    await expect(reopenBudget(db, account.id)).rejects.toThrow(
      `account is not a budget: ${account.id}`
    );
    expect(await getAccountById(db, account.id)).toMatchObject({
      archivedAt: "2026-07-01",
      monthlyBudget: 30_000,
    });
  });

  it("利用中の予算は再開しない", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-active",
      name: "日用品",
      type: "budget",
      monthlyBudget: 20_000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });

    await expect(reopenBudget(db, account.id)).rejects.toThrow(
      `budget is already active: ${account.id}`
    );
    expect(await getAccountById(db, account.id)).toMatchObject({
      archivedAt: null,
      monthlyBudget: 20_000,
    });
  });
});
