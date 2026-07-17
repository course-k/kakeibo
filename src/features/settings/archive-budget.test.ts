import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getAccountById, insertAccount } from "../../db/accounts-repository";
import {
  insertRecurringRule,
  listRecurringRules,
} from "../../db/recurring-rules-repository";
import { createTestDb } from "../../db/test-utils";
import { insertTransaction, softDeleteTransaction } from "../../db/transactions-repository";
import { archiveBudgetAndRules } from "./archive-budget";

describe("archiveBudgetAndRules", () => {
  it("対象口座をアーカイブし、from/toで参照する定期ルールを同時に削除する", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-food",
      name: "食費",
      type: "budget",
      monthlyBudget: 50_000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    await insertRecurringRule(db, {
      id: "rule-to-budget",
      type: "income",
      amount: 50_000,
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 1,
    });
    await insertRecurringRule(db, {
      id: "rule-from-budget",
      type: "expense_cash",
      amount: 1_000,
      fromAccountId: account.id,
      toAccountId: null,
      cardId: null,
      memo: "定期支出",
      dayOfMonth: 10,
    });
    await insertRecurringRule(db, {
      id: "rule-unrelated",
      type: "income",
      amount: 10_000,
      fromAccountId: null,
      toAccountId: "another-budget",
      cardId: null,
      memo: "別予算",
      dayOfMonth: 1,
    });

    await archiveBudgetAndRules(db, account.id, "2026-7-3");

    expect((await getAccountById(db, account.id))?.archivedAt).toBe("2026-07-03");
    expect((await listRecurringRules(db)).map((rule) => rule.id)).toEqual([
      "rule-unrelated",
    ]);
  });

  it("対象口座が存在しなければ例外を投げ、先行した定期ルール削除も戻す", async () => {
    const db = createTestDb();
    await insertRecurringRule(db, {
      id: "rule-dangling",
      type: "income",
      amount: 10_000,
      fromAccountId: null,
      toAccountId: "missing-budget",
      cardId: null,
      memo: "孤立ルール",
      dayOfMonth: 1,
    });

    await expect(
      archiveBudgetAndRules(db, "missing-budget", "2026-07-03")
    ).rejects.toThrow("終了する予算が見つかりません");

    expect((await listRecurringRules(db)).map((rule) => rule.id)).toEqual([
      "rule-dangling",
    ]);
  });

  it("カード支払準備口座は終了せず、関連ルールも保持する", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "card-settlement",
      name: "カード支払準備",
      type: "card_settlement",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    await insertRecurringRule(db, {
      id: "linked-rule",
      type: "adjustment",
      amount: 1_000,
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "残高調整",
      dayOfMonth: 1,
    });

    await expect(
      archiveBudgetAndRules(db, account.id, "2026-07-03"),
    ).rejects.toThrow("「カード支払準備」は予算ではないため終了できません");
    expect((await getAccountById(db, account.id))?.archivedAt).toBeNull();
    expect((await listRecurringRules(db)).map((rule) => rule.id)).toEqual(["linked-rule"]);
  });

  it("基準日残高が非0なら終了せず、口座とルールを保持する", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-food",
      name: "食費",
      type: "budget",
      monthlyBudget: 1_000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    await insertRecurringRule(db, {
      id: "monthly-rule",
      type: "income",
      amount: 1_000,
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 1,
    });
    await insertTransaction(db, {
      date: "2026-07-01",
      amount: 1_000,
      type: "income",
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      recurringRuleId: "monthly-rule",
    });

    await expect(
      archiveBudgetAndRules(db, account.id, "2026-07-03"),
    ).rejects.toThrow("「食費」の2026-07-03時点の残額が0円ではありません");
    expect((await getAccountById(db, account.id))?.archivedAt).toBeNull();
    expect((await listRecurringRules(db)).map((rule) => rule.id)).toEqual(["monthly-rule"]);
  });

  it("未来の有効取引があれば現在残高0でも終了しない", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-food",
      name: "食費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    await insertTransaction(db, {
      date: "2026-07-04",
      amount: 1_000,
      type: "expense_cash",
      fromAccountId: account.id,
      toAccountId: null,
      cardId: null,
      memo: "未来支出",
      recurringRuleId: null,
    });

    await expect(
      archiveBudgetAndRules(db, account.id, "2026-07-03"),
    ).rejects.toThrow("「食費」には2026-07-03より後の取引があるため終了できません");
    expect((await getAccountById(db, account.id))?.archivedAt).toBeNull();
  });

  it("論理削除済みの未来取引は終了を妨げない", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-food",
      name: "食費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    const future = await insertTransaction(db, {
      date: "2026-07-04",
      amount: 1_000,
      type: "expense_cash",
      fromAccountId: account.id,
      toAccountId: null,
      cardId: null,
      memo: "削除済み未来支出",
      recurringRuleId: null,
    });
    await softDeleteTransaction(db, future.id);

    await expect(archiveBudgetAndRules(db, account.id, "2026-07-03")).resolves.toBeUndefined();
    expect((await getAccountById(db, account.id))?.archivedAt).toBe("2026-07-03");
  });

  it("ルール削除後の口座更新が失敗した場合は両方rollbackする", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-food",
      name: "食費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    await insertRecurringRule(db, {
      id: "linked-rule",
      type: "expense_cash",
      amount: 100,
      fromAccountId: account.id,
      toAccountId: null,
      cardId: null,
      memo: "定期支出",
      dayOfMonth: 10,
    });
    db.run(sql.raw(`
      CREATE TRIGGER fail_archive_update
      BEFORE UPDATE OF archived_at ON accounts
      WHEN NEW.id = 'budget-food'
      BEGIN
        SELECT RAISE(FAIL, 'forced archive failure');
      END;
    `));

    await expect(archiveBudgetAndRules(db, account.id, "2026-07-03")).rejects.toThrow(
      "forced archive failure"
    );
    expect((await getAccountById(db, account.id))?.archivedAt).toBeNull();
    expect((await listRecurringRules(db)).map((rule) => rule.id)).toEqual(["linked-rule"]);
  });
});
