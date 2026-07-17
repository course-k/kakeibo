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
  softDeleteTransaction,
} from "../../db/transactions-repository";

import { updateBudgetAndMonthlyRule } from "./update-budget";
import { materializeRecurringRulesForMonth } from "../recurring/materialize-month";

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

  it("欠損した旧ルールIDを当月の生成済み取引から引き継ぎ二重充当を防ぐ", async () => {
    const { account, db } = await createBudget(10_000);
    const orphan = await addMaterializedIncome(db, account.id, "missing-rule", 10_000);

    const result = await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 12_000,
    });

    expect(result.monthlyRule?.id).toBe("missing-rule");
    expect(await listTransactions(db)).toMatchObject([
      { id: orphan.id, amount: 12_000, recurringRuleId: "missing-rule" },
    ]);
  });

  it("欠損した旧ルールの削除marker IDを引き継ぎ、削除状態を保つ", async () => {
    const { account, db } = await createBudget(10_000);
    const orphan = await addMaterializedIncome(db, account.id, "missing-rule", 10_000);
    await softDeleteTransaction(db, orphan.id);

    const result = await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 12_000,
    });

    expect(result.monthlyRule?.id).toBe("missing-rule");
    expect(await listTransactions(db)).toEqual([]);
    expect(await listTransactions(db, { includeDeleted: true })).toMatchObject([
      { id: orphan.id, deletedAt: expect.any(String), recurringRuleId: "missing-rule" },
    ]);
  });

  it("0円保存では欠損した旧ルールの当月active充当も論理削除する", async () => {
    const { account, db } = await createBudget(10_000);
    const orphan = await addMaterializedIncome(db, account.id, "missing-rule", 10_000);

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 0,
    });

    expect(await listTransactions(db)).toEqual([]);
    expect(await listTransactions(db, { includeDeleted: true })).toMatchObject([
      { id: orphan.id, deletedAt: expect.any(String) },
    ]);
  });

  it("有効ルールと単一の旧orphanが併存する場合は明示保存でorphanを論理削除する", async () => {
    const { account, db } = await createBudget(10_000);
    const rule = await addMonthlyRule(db, "rule-current", account.id, 10_000);
    await addMaterializedIncome(db, account.id, rule.id, 10_000);
    const orphan = await addMaterializedIncome(db, account.id, "rule-missing", 10_000);

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 12_000,
    });

    expect(await listTransactions(db)).toMatchObject([
      { recurringRuleId: rule.id, amount: 12_000 },
    ]);
    expect(await listTransactions(db, { includeDeleted: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: orphan.id, deletedAt: expect.any(String) }),
      ])
    );
  });

  it("重複ルール整理後のtombstoneをkeeperへ統合し、次回も保存できる", async () => {
    const { account, db } = await createBudget(10_000);
    for (const id of ["rule-first", "rule-second", "rule-third"]) {
      const rule = await addMonthlyRule(db, id, account.id, 10_000);
      await addMaterializedIncome(db, account.id, rule.id, 10_000);
    }

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 20_000,
    });
    await expect(
      updateBudgetAndMonthlyRule(db, account.id, {
        name: account.name,
        monthlyBudget: 30_000,
      })
    ).resolves.toMatchObject({ monthlyRule: { id: "rule-first", amount: 30_000 } });

    const all = await listTransactions(db, { includeDeleted: true });
    expect(all.every((transaction) => transaction.recurringRuleId === "rule-first")).toBe(true);
    expect(all.filter((transaction) => transaction.deletedAt === null)).toHaveLength(1);
  });

  it("keeper側markerがなくてもduplicate側の唯一のactive充当を引き継ぐ", async () => {
    const { account, db } = await createBudget(10_000);
    await addMonthlyRule(db, "rule-first", account.id, 10_000);
    const duplicate = await addMonthlyRule(db, "rule-second", account.id, 10_000);
    const materialized = await addMaterializedIncome(db, account.id, duplicate.id, 10_000);

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 20_000,
    });

    expect(await listTransactions(db)).toMatchObject([
      { id: materialized.id, recurringRuleId: "rule-first", amount: 20_000 },
    ]);
    expect(await listRecurringRules(db)).toMatchObject([
      { id: "rule-first", amount: 20_000 },
    ]);
  });

  it("keeper側markerがなくても単一active orphanをkeeperへ引き継ぐ", async () => {
    const { account, db } = await createBudget(10_000);
    await addMonthlyRule(db, "rule-first", account.id, 10_000);
    const orphan = await addMaterializedIncome(db, account.id, "rule-missing", 10_000);

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 20_000,
    });

    expect(await listTransactions(db)).toMatchObject([
      { id: orphan.id, recurringRuleId: "rule-first", amount: 20_000 },
    ]);
  });

  it("duplicate ruleの過去月markerもkeeperへ統合して再生成を防ぐ", async () => {
    const { account, db } = await createBudget(10_000);
    await addMonthlyRule(db, "rule-first", account.id, 10_000);
    const duplicate = await addMonthlyRule(db, "rule-second", account.id, 10_000);
    const past = await insertTransaction(db, {
      date: "2026-06-01", amount: 10_000, type: "income", fromAccountId: null,
      toAccountId: account.id, cardId: null, memo: "月初充当", recurringRuleId: duplicate.id,
    });

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 20_000,
    });

    expect(await listTransactions(db)).toMatchObject([
      { id: past.id, date: "2026-06-01", amount: 10_000, recurringRuleId: "rule-first" },
    ]);
    await expect(materializeRecurringRulesForMonth(db, "2026-06")).resolves.toMatchObject({
      created: [],
      skipped: 1,
    });
  });

  it("旧版の複数世代markerを明示保存で現行ruleへ統合する", async () => {
    const { account, db } = await createBudget(10_000);
    const current = await addMonthlyRule(db, "rule-current", account.id, 10_000);
    await insertTransaction(db, {
      date: "2026-05-01", amount: 10_000, type: "income", fromAccountId: null,
      toAccountId: account.id, cardId: null, memo: "月初充当", recurringRuleId: "rule-old-1",
    });
    await insertTransaction(db, {
      date: "2026-06-01", amount: 10_000, type: "income", fromAccountId: null,
      toAccountId: account.id, cardId: null, memo: "月初充当", recurringRuleId: "rule-old-2",
    });

    await expect(
      updateBudgetAndMonthlyRule(db, account.id, {
        name: account.name,
        monthlyBudget: 20_000,
      })
    ).resolves.toMatchObject({ monthlyRule: { id: current.id, amount: 20_000 } });

    expect(
      (await listTransactions(db)).every(
        (transaction) => transaction.recurringRuleId === current.id
      )
    ).toBe(true);
  });

  it("同月内で日付訂正された現行rule markerも新しい月額へ更新する", async () => {
    const { account, db } = await createBudget(10_000);
    const rule = await addMonthlyRule(db, "rule-current", account.id, 10_000);
    const moved = await insertTransaction(db, {
      date: currentMonthDate().replace(/-01$/, "-05"),
      amount: 10_000,
      type: "income",
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      recurringRuleId: rule.id,
    });

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 20_000,
    });

    expect(await listTransactions(db)).toMatchObject([
      { id: moved.id, date: expect.stringMatching(/-05$/), amount: 20_000 },
    ]);
  });

  it("同月別日へ訂正済みの欠損rule markerも新ruleへ引き継ぐ", async () => {
    const { account, db } = await createBudget(10_000);
    const orphan = await insertTransaction(db, {
      date: currentMonthDate().replace(/-01$/, "-05"),
      amount: 10_000,
      type: "income",
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      recurringRuleId: "rule-missing",
    });

    const result = await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 20_000,
    });

    expect(result.monthlyRule?.id).toBe("rule-missing");
    expect(await listTransactions(db)).toMatchObject([
      { id: orphan.id, date: expect.stringMatching(/-05$/), amount: 20_000 },
    ]);
  });

  it("現存する別日ruleの削除markerを月初ruleへ誤統合しない", async () => {
    const { account, db } = await createBudget(10_000);
    const monthly = await addMonthlyRule(db, "rule-monthly", account.id, 10_000);
    await addMaterializedIncome(db, account.id, monthly.id, 10_000);
    const other = await insertRecurringRule(db, {
      id: "rule-other-day",
      type: "income",
      amount: 500,
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 5,
    });
    const deleted = await insertTransaction(db, {
      date: currentMonthDate().replace(/-01$/, "-05"),
      amount: 500,
      type: "income",
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      recurringRuleId: other.id,
    });
    await softDeleteTransaction(db, deleted.id);

    await updateBudgetAndMonthlyRule(db, account.id, {
      name: account.name,
      monthlyBudget: 20_000,
    });

    expect(
      (await listTransactions(db, { includeDeleted: true })).find(
        (transaction) => transaction.id === deleted.id
      )
    ).toMatchObject({ recurringRuleId: other.id, deletedAt: expect.any(String) });
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
