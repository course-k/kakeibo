// 不変条件 6: エクスポート→インポートの往復で全データが一致する。
import { describe, expect, it } from "vitest";
import { insertAccount } from "./accounts-repository";
import { insertCard } from "./cards-repository";
import { createNodeDatabase } from "./test-utils";
import BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { EXPORT_SCHEMA_VERSION, exportData, importData, type ExportedData } from "./export-import";
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
    // 送出時点の全件数の確認（3 accounts / 1 card / 2 transactions（削除済み除く）/ 1 recurring rule）。
    expect(secondExport.accounts).toHaveLength(3);
    expect(secondExport.transactions).toHaveLength(2);
    expect(secondExport.transactions.map((t) => t.id)).toContain(spend.id);
  });

  it("importData は取り込み境界で date / archivedAt をゼロ埋め正規化する（項目2の穴を突くケース）", async () => {
    const db = createTestDb();
    const budget = await insertAccount(db, {
      name: "生活費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });

    // アプリ外で加工された（またはバグで非ゼロ埋めのまま出力された）ExportedData を想定。
    const denormalized: ExportedData = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      accounts: [
        {
          id: budget.id,
          name: budget.name,
          type: budget.type,
          monthlyBudget: budget.monthlyBudget,
          ownerId: budget.ownerId,
          sortOrder: budget.sortOrder,
          archivedAt: "2026-7-3",
          createdAt: budget.createdAt,
          updatedAt: budget.updatedAt,
        },
      ],
      cards: [],
      transactions: [
        {
          id: "tx-denormalized",
          date: "2026-7-3",
          amount: 1000,
          type: "income",
          fromAccountId: null,
          toAccountId: budget.id,
          cardId: null,
          memo: "",
          recurringRuleId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      recurringRules: [],
    };

    await importData(db, denormalized);
    const exported = await exportData(db);

    expect(exported.accounts[0].archivedAt).toBe("2026-07-03");
    expect(exported.transactions[0].date).toBe("2026-07-03");
  });

  it("項目1の回帰: importData が途中で失敗しても既存データは保持される（原子性）", async () => {
    const db = createTestDb();
    const budget = await insertAccount(db, {
      name: "生活費",
      type: "budget",
      monthlyBudget: 50000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    await insertTransaction(db, {
      date: "2026-01-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "既存データ",
      recurringRuleId: null,
    });

    const beforeFailure = await exportData(db);
    expect(beforeFailure.accounts).toHaveLength(1);
    expect(beforeFailure.transactions).toHaveLength(1);

    // accounts.name は NOT NULL 制約なので、この insert は DB レベルで例外を投げる。
    const broken: ExportedData = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      accounts: [
        {
          id: "broken-account",
          name: null as unknown as string,
          type: "budget",
          monthlyBudget: 0,
          ownerId: null,
          sortOrder: 0,
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      cards: [],
      transactions: [],
      recurringRules: [],
    };

    await expect(importData(db, broken)).rejects.toThrow();

    // ロールバックにより、削除前の既存データがそのまま残っていること。
    const afterFailure = await exportData(db);
    expect(afterFailure.accounts).toEqual(beforeFailure.accounts);
    expect(afterFailure.transactions).toEqual(beforeFailure.transactions);
  });
});
