import { describe, expect, it } from "vitest";
import { insertAccount, updateAccount } from "../../db/accounts-repository";
import { insertRecurringRule } from "../../db/recurring-rules-repository";
import { createTestDb } from "../../db/test-utils";
import {
  listTransactions,
  softDeleteTransaction,
} from "../../db/transactions-repository";
import {
  materializeRecurringRulesForCurrentMonth,
  materializeRecurringRulesForMonth,
} from "./materialize-month";

async function prepareMonthlyIncomeRule() {
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
  const rule = await insertRecurringRule(db, {
    id: "rule-monthly-income",
    type: "income",
    amount: 50_000,
    fromAccountId: null,
    toAccountId: account.id,
    cardId: null,
    memo: "月初充当",
    dayOfMonth: 31,
  });
  return { db, account, rule };
}

describe("materializeRecurringRulesForMonth", () => {
  it("対象月のルールを月末丸めした実取引として保存する", async () => {
    const { db, account, rule } = await prepareMonthlyIncomeRule();

    const result = await materializeRecurringRulesForMonth(db, "2026-02");

    expect(result.skipped).toBe(0);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({
      date: "2026-02-28",
      amount: 50_000,
      type: "income",
      toAccountId: account.id,
      recurringRuleId: rule.id,
    });
    expect(await listTransactions(db)).toEqual(result.created);
  });

  it("同じルール・同じ月は再実行しても重複生成しない", async () => {
    const { db } = await prepareMonthlyIncomeRule();

    await materializeRecurringRulesForMonth(db, "2026-07");
    const second = await materializeRecurringRulesForMonth(db, "2026-07");

    expect(second).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it("同じ DB・同じ月の同時実行でも重複生成しない", async () => {
    const { db } = await prepareMonthlyIncomeRule();

    const [first, second] = await Promise.all([
      materializeRecurringRulesForMonth(db, "2026-07"),
      materializeRecurringRulesForMonth(db, "2026-07"),
    ]);

    expect(first.created).toHaveLength(1);
    expect(second).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it("削除済みの定期取引を次回実行で復活させない", async () => {
    const { db } = await prepareMonthlyIncomeRule();
    const first = await materializeRecurringRulesForMonth(db, "2026-07");
    await softDeleteTransaction(db, first.created[0].id);

    const second = await materializeRecurringRulesForMonth(db, "2026-07");

    expect(second).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toEqual([]);
    expect(await listTransactions(db, { includeDeleted: true })).toHaveLength(1);
  });

  it("終了済み予算を参照するルールは生成しない", async () => {
    const { db, account } = await prepareMonthlyIncomeRule();
    await updateAccount(db, account.id, { archivedAt: "2026-07-01" });

    const result = await materializeRecurringRulesForMonth(db, "2026-07");

    expect(result).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toEqual([]);
  });

  it("端末ローカル日付から当月を選ぶ", async () => {
    const { db } = await prepareMonthlyIncomeRule();

    const result = await materializeRecurringRulesForCurrentMonth(
      db,
      new Date(2026, 6, 31, 12, 0, 0),
    );

    expect(result.created[0].date).toBe("2026-07-31");
  });

  it("当月でも発生日が未来のルールは前倒し生成しない", async () => {
    const { db } = await prepareMonthlyIncomeRule();

    const result = await materializeRecurringRulesForCurrentMonth(
      db,
      new Date(2026, 6, 17, 12, 0, 0),
    );

    expect(result).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toEqual([]);
  });

  it("current month API は過去月を自動 catch-up しない", async () => {
    const { db } = await prepareMonthlyIncomeRule();

    await materializeRecurringRulesForCurrentMonth(
      db,
      new Date(2026, 6, 31, 12, 0, 0),
    );

    expect((await listTransactions(db)).map((transaction) => transaction.date)).toEqual([
      "2026-07-31",
    ]);
  });

  it("不正な年月を拒否する", async () => {
    const { db } = await prepareMonthlyIncomeRule();

    await expect(
      materializeRecurringRulesForMonth(db, "2026-13"),
    ).rejects.toThrow("invalid year-month");
  });
});
