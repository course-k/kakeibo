import { afterEach, describe, expect, it, vi } from "vitest";
import { listAccounts } from "../../db/accounts-repository";
import {
  insertRecurringRule,
  listRecurringRules,
} from "../../db/recurring-rules-repository";
import { createTestDb } from "../../db/test-utils";
import { createBudgetWithMonthlyRule } from "./budgets";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBudgetWithMonthlyRule", () => {
  it("予算口座と同額の月初充当ルールを一緒に作成する", async () => {
    const db = createTestDb();

    const result = await createBudgetWithMonthlyRule(db, {
      name: "食費",
      monthlyBudget: 50_000,
      sortOrder: 2,
    });

    expect(result.account).toMatchObject({
      name: "食費",
      type: "budget",
      monthlyBudget: 50_000,
      sortOrder: 2,
    });
    expect(result.recurringRule).toMatchObject({
      type: "income",
      amount: 50_000,
      fromAccountId: null,
      toAccountId: result.account.id,
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 1,
    });
    expect(await listAccounts(db, { includeArchived: true })).toEqual([result.account]);
    expect(await listRecurringRules(db)).toEqual([result.recurringRule]);
  });

  it("月予算が0円なら予算口座だけを作成する", async () => {
    const db = createTestDb();

    const result = await createBudgetWithMonthlyRule(db, {
      name: "自由費",
      monthlyBudget: 0,
      sortOrder: 0,
    });

    expect(result.recurringRule).toBeNull();
    expect(await listAccounts(db, { includeArchived: true })).toEqual([result.account]);
    expect(await listRecurringRules(db)).toEqual([]);
  });

  it("月初ルールのinsertが失敗した場合は予算口座も残さない", async () => {
    const db = createTestDb();
    const duplicateRuleId = "00000000-0000-4000-8000-000000000002";
    await insertRecurringRule(db, {
      id: duplicateRuleId,
      type: "income",
      amount: 1,
      fromAccountId: null,
      toAccountId: "existing-budget",
      cardId: null,
      memo: "既存ルール",
      dayOfMonth: 1,
    });
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce(duplicateRuleId);

    await expect(
      createBudgetWithMonthlyRule(db, {
        name: "食費",
        monthlyBudget: 50_000,
        sortOrder: 0,
      })
    ).rejects.toThrow();

    expect(await listAccounts(db, { includeArchived: true })).toEqual([]);
    expect((await listRecurringRules(db)).map((rule) => rule.id)).toEqual([
      duplicateRuleId,
    ]);
  });
});
