// 不変条件 6: エクスポート→インポートの往復で全データが一致する。
import { describe, expect, it } from "vitest";
import { insertAccount } from "./accounts-repository";
import { insertCard } from "./cards-repository";
import { createNodeDatabase } from "./client";
import BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { exportData, importData } from "./export-import";
import { insertRecurringRule } from "./recurring-rules-repository";
import { createTestDb } from "./test-utils";
import { insertTransaction, softDeleteTransaction } from "./transactions-repository";

describe("export-import 往復一致（不変条件6）", () => {
  it("export→import→export で全データが一致する", async () => {
    const db = createTestDb();
    const budget = await insertAccount(db, {
      name: "生活費",
      type: "budget",
      monthlyBudget: 50000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    const archivedBudget = await insertAccount(db, {
      name: "旧予算",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 1,
      archivedAt: "2026-06-01",
    });
    const settlement = await insertAccount(db, {
      name: "カードA決済口座",
      type: "card_settlement",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 2,
      archivedAt: null,
    });
    const card = await insertCard(db, {
      name: "カードA",
      settlementAccountId: settlement.id,
      closingDay: 15,
      debitDay: 27,
    });
    await insertRecurringRule(db, {
      type: "income",
      amount: 50000,
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "月初充当",
      dayOfMonth: 1,
    });
    await insertTransaction(db, {
      date: "2026-01-01",
      amount: 50000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "初期入金",
      recurringRuleId: null,
    });
    const spend = await insertTransaction(db, {
      date: "2026-01-05",
      amount: 3000,
      type: "expense_card",
      fromAccountId: budget.id,
      toAccountId: settlement.id,
      cardId: card.id,
      memo: "スーパー",
      recurringRuleId: null,
    });
    // 論理削除された取引はエクスポートに現れないはず（不変条件5と整合）。
    const deleted = await insertTransaction(db, {
      date: "2026-01-06",
      amount: 100,
      type: "expense_cash",
      fromAccountId: budget.id,
      toAccountId: null,
      cardId: null,
      memo: "取消予定",
      recurringRuleId: null,
    });
    await softDeleteTransaction(db, deleted.id);

    const firstExport = await exportData(db);
    expect(firstExport.transactions.map((t) => t.id).sort()).not.toContain(deleted.id);

    // 別の新規 DB へインポートする（機種変更相当）。
    const nativeDb2 = new BetterSqlite3(":memory:");
    const db2 = createNodeDatabase(nativeDb2);
    migrate(db2, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });

    await importData(db2, firstExport);
    const secondExport = await exportData(db2);

    expect(secondExport.accounts).toEqual(firstExport.accounts);
    expect(secondExport.cards).toEqual(firstExport.cards);
    expect(secondExport.transactions).toEqual(firstExport.transactions);
    expect(secondExport.recurringRules).toEqual(firstExport.recurringRules);

    // 元 DB へ importData で全置き換えしても不変（自己往復）。
    await importData(db, firstExport);
    const thirdExport = await exportData(db);
    expect(thirdExport.accounts).toEqual(firstExport.accounts);
    expect(thirdExport.cards).toEqual(firstExport.cards);
    expect(thirdExport.transactions).toEqual(firstExport.transactions);
    expect(thirdExport.recurringRules).toEqual(firstExport.recurringRules);

    // archivedBudget も往復で保持されている（アーカイブは論理削除ではないため）。
    expect(secondExport.accounts.some((a) => a.id === archivedBudget.id)).toBe(true);
    // 送出時点の全件数の確認（4 accounts / 1 card / 2 transactions（削除済み除く）/ 1 recurring rule）。
    expect(secondExport.accounts).toHaveLength(3);
    expect(secondExport.transactions).toHaveLength(2);
    expect(secondExport.transactions.map((t) => t.id)).toContain(spend.id);
  });
});
