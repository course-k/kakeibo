import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAccountById, insertAccount } from "../../db/accounts-repository";
import {
  insertRecurringRule,
  listRecurringRules,
} from "../../db/recurring-rules-repository";
import { createTestDb } from "../../db/test-utils";
import {
  insertTransaction,
  listTransactions,
} from "../../db/transactions-repository";

import { updateBudgetAndMonthlyRule } from "./update-budget";

async function createBudget(monthlyBudget = 0) {
  const db = createTestDb();
  const account = await insertAccount(db, {
    id: "budget-food",
    name: "食費",
    type: "budget",
    monthlyBudget,
    ownerId: null,
    sortOrder: 0,
    archivedAt: null,
  });
  return { account, db };
}

async function addMonthlyRule(
  db: ReturnType<typeof createTestDb>,
  id: string,
  accountId = "budget-food",
  amount = 10_000
) {
  return insertRecurringRule(db, {
    id,
    type: "income",
    amount,
    fromAccountId: null,
    toAccountId: accountId,
    cardId: null,
    memo: "月初充当",
    dayOfMonth: 1,
  });
}

function currentMonthDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

async function addMaterializedIncome(
  db: ReturnType<typeof createTestDb>,
  accountId: string,
  ruleId: string,
  amount: number
) {
  return insertTransaction(db, {
    date: currentMonthDate(),
    amount,
    type: "income",
    fromAccountId: null,
    toAccountId: accountId,
    cardId: null,
    memo: "月初充当",
    recurringRuleId: ruleId,
  });
}

describe("updateBudgetAndMonthlyRule", () => {
  it("口座を更新し、先頭ルールのIDを保って金額を更新し、重複を削除する", async () => {
    const { account, db } = await createBudget(10_000);
    await addMonthlyRule(db, "rule-first", account.id, 10_000);
    await addMonthlyRule(db, "rule-duplicate", account.id, 20_000);

    const result = await updateBudgetAndMonthlyRule(db, account.id, {
      name: "食費・日用品",
      monthlyBudget: 30_000,
    });

    expect(result.account).toMatchObject({
      id: account.id,
      name: "食費・日用品",
      monthlyBudget: 30_000,
    });
    expect(result.monthlyRule).toMatchObject({ id: "rule-first", amount: 30_000 });
    expect(await listRecurringRules(db)).toMatchObject([
      { id: "rule-first", toAccountId: account.id, amount: 30_000 },
    ]);
  });

  it("月額を0円にすると対象の月初ルールをすべて削除する", async () => {
    const { account, db } = await createBudget(10_000);
    await addMonthlyRule(db, "rule-first", account.id);
    await addMonthlyRule(db, "rule-duplicate", account.id);

    const result = await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 0,
    });

    expect(result.monthlyRule).toBeNull();
    expect((await getAccountById(db, account.id))?.monthlyBudget).toBe(0);
    expect(await listRecurringRules(db)).toEqual([]);
  });

  it("ルールがない予算を0円から正額へ変更すると月初ルールを新規作成する", async () => {
    const { account, db } = await createBudget(0);

    const result = await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 12_000,
    });

    expect(result.monthlyRule).toMatchObject({
      type: "income",
      amount: 12_000,
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      dayOfMonth: 1,
    });
    expect(await listRecurringRules(db)).toHaveLength(1);
    expect(await listTransactions(db)).toEqual([]);
  });

  it("当月の月初取引が生成済みならルールと同額へ更新する", async () => {
    const { account, db } = await createBudget(10_000);
    const rule = await addMonthlyRule(db, "rule-first", account.id, 10_000);
    const materialized = await addMaterializedIncome(db, account.id, rule.id, 10_000);

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 30_000,
    });

    expect(await listTransactions(db)).toMatchObject([
      { id: materialized.id, amount: 30_000, recurringRuleId: rule.id },
    ]);
    expect(await listRecurringRules(db)).toMatchObject([
      { id: rule.id, amount: 30_000 },
    ]);
  });

  it("月額を0円にすると当月の生成済み月初取引も論理削除する", async () => {
    const { account, db } = await createBudget(10_000);
    const rule = await addMonthlyRule(db, "rule-first", account.id, 10_000);
    const materialized = await addMaterializedIncome(db, account.id, rule.id, 10_000);

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 0,
    });

    expect(await listTransactions(db)).toEqual([]);
    expect(await listTransactions(db, { includeDeleted: true })).toMatchObject([
      { id: materialized.id, deletedAt: expect.any(String) },
    ]);
    expect(await listRecurringRules(db)).toEqual([]);
  });

  it("対象口座が存在しない場合はルールを作成しない", async () => {
    const db = createTestDb();

    await expect(
      updateBudgetAndMonthlyRule(db, "missing", { name: "不明", monthlyBudget: 5_000 })
    ).rejects.toThrow("account not found: missing");

    expect(await listRecurringRules(db)).toEqual([]);
  });

  it("後段のルール更新が失敗した場合は口座更新もロールバックする", async () => {
    const { account, db } = await createBudget(10_000);
    await addMonthlyRule(db, "rule-first", account.id, 10_000);
    db.run(sql.raw(`
      CREATE TRIGGER fail_monthly_rule_update
      BEFORE UPDATE ON recurring_rules
      BEGIN
        SELECT RAISE(ABORT, 'forced rule update failure');
      END
    `));

    await expect(
      updateBudgetAndMonthlyRule(db, account.id, {
        name: "変更後",
        monthlyBudget: 99_000,
      })
    ).rejects.toThrow("forced rule update failure");

    expect(await getAccountById(db, account.id)).toMatchObject({
      name: "食費",
      monthlyBudget: 10_000,
    });
    expect(await listRecurringRules(db)).toMatchObject([
      { id: "rule-first", amount: 10_000 },
    ]);
  });
});
