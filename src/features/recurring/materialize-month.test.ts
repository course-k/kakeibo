import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { insertAccount, updateAccount } from "../../db/accounts-repository";
import { EXPORT_SCHEMA_VERSION, importData, type ExportedData } from "../../db/export-import";
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

async function prepareRecurringIncomeRule() {
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
  it("月額と同額の月初ルールが1件なら実取引化する", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      id: "budget-monthly",
      name: "毎月予算",
      type: "budget",
      monthlyBudget: 50_000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    await insertRecurringRule(db, {
      id: "monthly-rule",
      type: "income",
      amount: 50_000,
      fromAccountId: null,
      toAccountId: account.id,
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 1,
    });

    const result = await materializeRecurringRulesForMonth(db, "2026-07");

    expect(result.created).toMatchObject([
      { amount: 50_000, date: "2026-07-01", recurringRuleId: "monthly-rule" },
    ]);
  });

  it("対象月のルールを月末丸めした実取引として保存する", async () => {
    const { db, account, rule } = await prepareRecurringIncomeRule();

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
    const { db } = await prepareRecurringIncomeRule();

    await materializeRecurringRulesForMonth(db, "2026-07");
    const second = await materializeRecurringRulesForMonth(db, "2026-07");

    expect(second).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it("同じ DB・同じ月の同時実行でも重複生成しない", async () => {
    const { db } = await prepareRecurringIncomeRule();

    const [first, second] = await Promise.all([
      materializeRecurringRulesForMonth(db, "2026-07"),
      materializeRecurringRulesForMonth(db, "2026-07"),
    ]);

    expect(first.created).toHaveLength(1);
    expect(second).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it("削除済みの定期取引を次回実行で復活させない", async () => {
    const { db } = await prepareRecurringIncomeRule();
    const first = await materializeRecurringRulesForMonth(db, "2026-07");
    await softDeleteTransaction(db, first.created[0].id);

    const second = await materializeRecurringRulesForMonth(db, "2026-07");

    expect(second).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toEqual([]);
    expect(await listTransactions(db, { includeDeleted: true })).toHaveLength(1);
  });

  it("終了済み予算を参照するルールは生成しない", async () => {
    const { db, account } = await prepareRecurringIncomeRule();
    await updateAccount(db, account.id, { archivedAt: "2026-07-01" });

    const result = await materializeRecurringRulesForMonth(db, "2026-07");

    expect(result).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toEqual([]);
  });

  it("端末ローカル日付から当月を選ぶ", async () => {
    const { db } = await prepareRecurringIncomeRule();

    const result = await materializeRecurringRulesForCurrentMonth(
      db,
      new Date(2026, 6, 31, 12, 0, 0),
    );

    expect(result.created[0].date).toBe("2026-07-31");
  });

  it("当月でも発生日が未来のルールは前倒し生成しない", async () => {
    const { db } = await prepareRecurringIncomeRule();

    const result = await materializeRecurringRulesForCurrentMonth(
      db,
      new Date(2026, 6, 17, 12, 0, 0),
    );

    expect(result).toEqual({ created: [], skipped: 1 });
    expect(await listTransactions(db)).toEqual([]);
  });

  it("current month API は過去月を自動 catch-up しない", async () => {
    const { db } = await prepareRecurringIncomeRule();

    await materializeRecurringRulesForCurrentMonth(
      db,
      new Date(2026, 6, 31, 12, 0, 0),
    );

    expect((await listTransactions(db)).map((transaction) => transaction.date)).toEqual([
      "2026-07-31",
    ]);
  });

  it("不正な年月を拒否する", async () => {
    const { db } = await prepareRecurringIncomeRule();

    await expect(
      materializeRecurringRulesForMonth(db, "2026-13"),
    ).rejects.toThrow("invalid year-month");
  });

  it.each([
    { monthlyBudget: 50_000, ruleAmounts: [] },
    { monthlyBudget: 50_000, ruleAmounts: [30_000] },
    { monthlyBudget: 50_000, ruleAmounts: [50_000, 50_000] },
    { monthlyBudget: 0, ruleAmounts: [10_000] },
  ])(
    "月額と月初ルールが不一致なら書き込まず拒否する: $monthlyBudget / $ruleAmounts",
    async ({ monthlyBudget, ruleAmounts }) => {
      const db = createTestDb();
      const account = await insertAccount(db, {
        id: "budget-legacy",
        name: "旧予算",
        type: "budget",
        monthlyBudget,
        ownerId: null,
        sortOrder: 0,
        archivedAt: null,
      });
      for (const [index, amount] of ruleAmounts.entries()) {
        await insertRecurringRule(db, {
          id: `legacy-rule-${index}`,
          type: "income",
          amount,
          fromAccountId: null,
          toAccountId: account.id,
          cardId: null,
          memo: "月初充当",
          dayOfMonth: 1,
        });
      }

      await expect(
        materializeRecurringRulesForMonth(db, "2026-07"),
      ).rejects.toThrow(
        "毎月の予算設定が一致していません。「旧予算」を設定で編集し、金額を確認して保存してください",
      );
      expect(await listTransactions(db, { includeDeleted: true })).toEqual([]);
    },
  );

  it("復旧前形式の不整合backupはimportできるがmaterialize前に安全停止する", async () => {
    const db = createTestDb();
    const legacyBackup: ExportedData = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: "2026-07-01T00:00:00.000Z",
      accounts: [
        {
          id: "budget-legacy",
          name: "旧予算",
          type: "budget",
          monthlyBudget: 50_000,
          ownerId: null,
          sortOrder: 0,
          archivedAt: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      cards: [],
      transactions: [],
      recurringRules: [
        {
          id: "legacy-rule",
          type: "income",
          amount: 30_000,
          fromAccountId: null,
          toAccountId: "budget-legacy",
          cardId: null,
          memo: "月初充当",
          dayOfMonth: 1,
        },
      ],
    };

    await expect(importData(db, legacyBackup)).resolves.toBeUndefined();
    await expect(
      materializeRecurringRulesForMonth(db, "2026-07"),
    ).rejects.toThrow("毎月の予算設定が一致していません");
    expect(await listTransactions(db, { includeDeleted: true })).toEqual([]);
  });

  it("複数ルールの途中でinsertが失敗しても全件rollbackする", async () => {
    const db = createTestDb();
    for (const suffix of ["a", "b"]) {
      const account = await insertAccount(db, {
        id: `budget-${suffix}`,
        name: `予算${suffix}`,
        type: "budget",
        monthlyBudget: 1000,
        ownerId: null,
        sortOrder: suffix === "a" ? 0 : 1,
        archivedAt: null,
      });
      await insertRecurringRule(db, {
        id: `rule-${suffix}`,
        type: "income",
        amount: 1000,
        fromAccountId: null,
        toAccountId: account.id,
        cardId: null,
        memo: "月初充当",
        dayOfMonth: 1,
      });
    }
    db.run(sql.raw(`
      CREATE TRIGGER fail_second_materialization
      BEFORE INSERT ON transactions
      WHEN NEW.recurring_rule_id = 'rule-b'
      BEGIN
        SELECT RAISE(FAIL, 'forced materialization failure');
      END;
    `));

    await expect(materializeRecurringRulesForMonth(db, "2026-07")).rejects.toThrow(
      "forced materialization failure"
    );
    expect(await listTransactions(db, { includeDeleted: true })).toEqual([]);
  });

  it("同一batchの入金が先に登録されたtransferルールの残高へ日付順に反映される", async () => {
    const db = createTestDb();
    const from = await insertAccount(db, {
      id: "budget-from",
      name: "移動元",
      type: "budget",
      monthlyBudget: 1000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    const to = await insertAccount(db, {
      id: "budget-to",
      name: "移動先",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 1,
      archivedAt: null,
    });
    // transferを先にinsertして、DB列順が会計結果を変えないことを確認する。
    await insertRecurringRule(db, {
      id: "rule-transfer",
      type: "transfer",
      amount: 800,
      fromAccountId: from.id,
      toAccountId: to.id,
      cardId: null,
      memo: "予算移動",
      dayOfMonth: 10,
    });
    await insertRecurringRule(db, {
      id: "rule-income",
      type: "income",
      amount: 1000,
      fromAccountId: null,
      toAccountId: from.id,
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 1,
    });

    await expect(materializeRecurringRulesForMonth(db, "2026-07")).resolves.toMatchObject({
      created: expect.arrayContaining([
        expect.objectContaining({ recurringRuleId: "rule-income" }),
        expect.objectContaining({ recurringRuleId: "rule-transfer" }),
      ]),
    });
  });
});
