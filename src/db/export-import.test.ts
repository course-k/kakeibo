// 不変条件 6: エクスポート→インポートの往復で全データが一致する。
import { describe, expect, it } from "vitest";
import { insertAccount } from "./accounts-repository";
import { insertCard } from "./cards-repository";
import { insertCategory } from "./categories-repository";
import { createNodeDatabase, createTestDb } from "./test-utils";
import BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { EXPORT_SCHEMA_VERSION, exportData, importData, type ExportedData } from "./export-import";
import { insertRecurringRule } from "./recurring-rules-repository";
import {
  insertTransaction,
  listTransactions,
  softDeleteTransaction,
} from "./transactions-repository";

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
    const incomeCategory = await insertCategory(db, {
      id: "salary",
      name: "給与",
      kind: "income",
      sortOrder: 0,
    });
    const expenseCategory = await insertCategory(db, {
      id: "groceries",
      name: "食費",
      kind: "expense",
      sortOrder: 0,
    });
    const rule = await insertRecurringRule(db, {
      type: "income",
      amount: 50000,
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      categoryId: incomeCategory.id,
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
      categoryId: incomeCategory.id,
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
      categoryId: expenseCategory.id,
      memo: "スーパー",
      recurringRuleId: null,
    });
    // 定期取引由来の削除 tombstone。復元後も再生成を防ぐためバックアップ対象にする。
    const deleted = await insertTransaction(db, {
      date: "2026-01-06",
      amount: 100,
      type: "expense_cash",
      fromAccountId: budget.id,
      toAccountId: null,
      cardId: null,
      categoryId: expenseCategory.id,
      memo: "取消予定",
      recurringRuleId: rule.id,
    });
    await softDeleteTransaction(db, deleted.id);

    const firstExport = await exportData(db);
    expect(firstExport.transactions.map((t) => t.id)).toContain(deleted.id);
    expect(firstExport.transactions.find((t) => t.id === deleted.id)?.deletedAt).not.toBeNull();

    // 別の新規 DB へインポートする（機種変更相当）。
    const nativeDb2 = new BetterSqlite3(":memory:");
    const db2 = createNodeDatabase(nativeDb2);
    migrate(db2, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });

    await importData(db2, firstExport);
    const secondExport = await exportData(db2);

    expect(secondExport.accounts).toEqual(firstExport.accounts);
    expect(secondExport.cards).toEqual(firstExport.cards);
    expect(secondExport.categories).toEqual(firstExport.categories);
    expect(secondExport.transactions).toEqual(firstExport.transactions);
    expect(secondExport.recurringRules).toEqual(firstExport.recurringRules);
    expect(
      (await listTransactions(db2, { includeDeleted: true })).find((t) => t.id === deleted.id)
        ?.recurringRuleId
    ).toBe(rule.id);

    // 元 DB へ importData で全置き換えしても不変（自己往復）。
    await importData(db, firstExport);
    const thirdExport = await exportData(db);
    expect(thirdExport.accounts).toEqual(firstExport.accounts);
    expect(thirdExport.cards).toEqual(firstExport.cards);
    expect(thirdExport.categories).toEqual(firstExport.categories);
    expect(thirdExport.transactions).toEqual(firstExport.transactions);
    expect(thirdExport.recurringRules).toEqual(firstExport.recurringRules);

    // archivedBudget も往復で保持されている（アーカイブは論理削除ではないため）。
    expect(secondExport.accounts.some((a) => a.id === archivedBudget.id)).toBe(true);
    // 送出時点の全件数の確認（3 accounts / 1 card / 3 transactions（tombstone含む）/ 1 recurring rule）。
    expect(secondExport.accounts).toHaveLength(3);
    expect(secondExport.transactions).toHaveLength(3);
    expect(secondExport.transactions.map((t) => t.id)).toContain(spend.id);
  });

  it("不正なバックアップは書き込み前に拒否し既存 DB を変更しない", async () => {
    const invalidCases: {
      name: string;
      mutate: (data: ExportedData) => void;
    }[] = [
      {
        name: "未知のschemaVersion",
        mutate: (data) => {
          data.schemaVersion = EXPORT_SCHEMA_VERSION + 1;
        },
      },
      {
        name: "必須primitive欠落",
        mutate: (data) => {
          data.accounts[0].name = null as unknown as string;
        },
      },
      {
        name: "account参照切れ",
        mutate: (data) => {
          data.transactions[0].toAccountId = "missing-account";
        },
      },
      {
        name: "取引の意味的不正",
        mutate: (data) => {
          data.transactions[0].amount = 0;
        },
      },
      {
        name: "定期ルールの意味的不正",
        mutate: (data) => {
          data.recurringRules[0].fromAccountId = data.accounts[0].id;
        },
      },
      {
        name: "category参照切れ",
        mutate: (data) => {
          data.transactions[0].categoryId = "missing-category";
        },
      },
      {
        name: "category種別不一致",
        mutate: (data) => {
          data.transactions[0].categoryId = "expense-category";
        },
      },
      {
        name: "決済口座の1対1違反",
        mutate: (data) => {
          data.accounts.push({
            ...data.accounts[0],
            id: "settlement",
            name: "支払準備",
            type: "card_settlement",
            monthlyBudget: 0,
          });
          data.cards.push(
            {
              id: "card-1",
              name: "カード1",
              settlementAccountId: "settlement",
              closingDay: 15,
              debitDay: 27,
            },
            {
              id: "card-2",
              name: "カード2",
              settlementAccountId: "settlement",
              closingDay: null,
              debitDay: 10,
            }
          );
        },
      },
    ];

    for (const invalidCase of invalidCases) {
      const db = createTestDb();
      const account = await insertAccount(db, {
        id: "existing",
        name: "既存口座",
        type: "budget",
        monthlyBudget: 1000,
        ownerId: null,
        sortOrder: 0,
        archivedAt: null,
      });
      await insertTransaction(db, {
        id: "existing-tx",
        date: "2026-01-01",
        amount: 1000,
        type: "income",
        fromAccountId: null,
        toAccountId: account.id,
        cardId: null,
        memo: "既存",
        recurringRuleId: null,
      });
      const before = await exportData(db);
      const candidate: ExportedData = {
        schemaVersion: EXPORT_SCHEMA_VERSION,
        exportedAt: "2026-07-17T00:00:00.000Z",
        accounts: [
          {
            id: "budget",
            name: "生活費",
            type: "budget",
            monthlyBudget: 50000,
            ownerId: null,
            sortOrder: 0,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        cards: [],
        categories: [
          {
            id: "income-category",
            name: "給与",
            kind: "income",
            sortOrder: 0,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "expense-category",
            name: "食費",
            kind: "expense",
            sortOrder: 0,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        transactions: [
          {
            id: "tx",
            date: "2026-07-01",
            amount: 50000,
            type: "income",
            fromAccountId: null,
            toAccountId: "budget",
            cardId: null,
            categoryId: "income-category",
            memo: "月初充当",
            recurringRuleId: "rule",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            deletedAt: null,
          },
        ],
        recurringRules: [
          {
            id: "rule",
            type: "income",
            amount: 50000,
            fromAccountId: null,
            toAccountId: "budget",
            cardId: null,
            categoryId: "income-category",
            memo: "月初充当",
            dayOfMonth: 1,
          },
        ],
      };
      invalidCase.mutate(candidate);

      await expect(importData(db, candidate), invalidCase.name).rejects.toThrow(/invalid backup/);
      expect(await exportData(db), invalidCase.name).toMatchObject({
        accounts: before.accounts,
        cards: before.cards,
        categories: before.categories,
        transactions: before.transactions,
        recurringRules: before.recurringRules,
      });
    }
  });

  it("v1 backup を migration と同じ category 規則で v2 に正規化する", async () => {
    const db = createTestDb();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const legacyV1 = {
      schemaVersion: 1,
      exportedAt: "2026-07-17T00:00:00.000Z",
      accounts: [
        {
          id: "budget",
          name: "生活費",
          type: "budget",
          monthlyBudget: 50000,
          ownerId: null,
          sortOrder: 3,
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      cards: [],
      transactions: [
        {
          id: "income",
          date: "2026-07-01",
          amount: 50000,
          type: "income",
          fromAccountId: null,
          toAccountId: "budget",
          cardId: null,
          memo: "月初充当",
          recurringRuleId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        },
        {
          id: "expense",
          date: "2026-07-02",
          amount: 1000,
          type: "expense_cash",
          fromAccountId: "budget",
          toAccountId: null,
          cardId: null,
          memo: "食費",
          recurringRuleId: "expense-rule",
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        },
      ],
      recurringRules: [
        {
          id: "expense-rule",
          type: "expense_cash",
          amount: 1000,
          fromAccountId: "budget",
          toAccountId: null,
          cardId: null,
          memo: "食費",
          dayOfMonth: 2,
        },
      ],
    };

    await importData(db, legacyV1);
    const upgraded = await exportData(db);

    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.categories.map((category) => category.id).sort()).toEqual([
      "default-expense-other",
      "default-income-other",
      "legacy-budget-budget",
    ]);
    expect(upgraded.categories.find((category) => category.id === "legacy-budget-budget")).toMatchObject({
      name: "生活費",
      kind: "expense",
      sortOrder: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(upgraded.transactions.find((transaction) => transaction.id === "expense")?.categoryId).toBe(
      "legacy-budget-budget"
    );
    expect(upgraded.recurringRules[0].categoryId).toBe("legacy-budget-budget");
    expect(upgraded.transactions.find((transaction) => transaction.id === "income")?.categoryId).toBeNull();
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
      categories: [
        {
          id: "income-category",
          name: "給与",
          kind: "income",
          sortOrder: 0,
          archivedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      transactions: [
        {
          id: "tx-denormalized",
          date: "2026-7-3",
          amount: 1000,
          type: "income",
          fromAccountId: null,
          toAccountId: budget.id,
          cardId: null,
          categoryId: "income-category",
          memo: "",
          // 生成後に元ルールを削除した正常データ。recurring_rules に FK は持たない。
          recurringRuleId: "deleted-rule",
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
    expect(exported.transactions[0].recurringRuleId).toBe("deleted-rule");
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
      categories: [],
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
