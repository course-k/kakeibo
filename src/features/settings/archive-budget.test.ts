import { describe, expect, it } from "vitest";
import { getAccountById, insertAccount } from "../../db/accounts-repository";
import {
  insertRecurringRule,
  listRecurringRules,
} from "../../db/recurring-rules-repository";
import { createTestDb } from "../../db/test-utils";
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
    ).rejects.toThrow("account not found: missing-budget");

    expect((await listRecurringRules(db)).map((rule) => rule.id)).toEqual([
      "rule-dangling",
    ]);
  });
});
