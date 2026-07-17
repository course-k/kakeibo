import { describe, expect, it } from "vitest";
import { insertAccount, updateAccount } from "./accounts-repository";
import { insertCard } from "./cards-repository";
import { createTestDb } from "./test-utils";
import {
  getTransactionById,
  insertTransaction,
  listTransactions,
  listTransactionsByAccount,
  softDeleteTransaction,
  updateTransaction,
} from "./transactions-repository";

async function seedAccounts(db: ReturnType<typeof createTestDb>) {
  const budget = await insertAccount(db, {
    name: "生活費",
    type: "budget",
    monthlyBudget: 50000,
    ownerId: null,
    sortOrder: 0,
    archivedAt: null,
  });
  const settlement = await insertAccount(db, {
    name: "カードA決済口座",
    type: "card_settlement",
    monthlyBudget: 0,
    ownerId: null,
    sortOrder: 1,
    archivedAt: null,
  });
  const card = await insertCard(db, {
    name: "カードA",
    settlementAccountId: settlement.id,
    closingDay: null,
    debitDay: 27,
  });
  return { budget, settlement, card };
}

describe("transactions-repository", () => {
  it("妥当な取引を insert して取得できる", async () => {
    const db = createTestDb();
    const { budget, settlement, card } = await seedAccounts(db);
    const tx = await insertTransaction(db, {
      date: "2026-01-15",
      amount: 3000,
      type: "expense_card",
      fromAccountId: budget.id,
      toAccountId: settlement.id,
      cardId: card.id,
      memo: "スーパー",
      recurringRuleId: null,
    });
    expect(tx.id).toBeTruthy();
    expect(tx.deletedAt).toBeNull();

    const found = await getTransactionById(db, tx.id);
    expect(found).toEqual(tx);
  });

  it("日付をゼロ埋め正規化して保存する（境界層での正規化）", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const tx = await insertTransaction(db, {
      date: "2026-7-3",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });
    expect(tx.date).toBe("2026-07-03");
  });

  it("不変条件1: 不正な金額の取引は保存を拒否する", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    await expect(
      insertTransaction(db, {
        date: "2026-01-01",
        amount: 0,
        type: "income",
        fromAccountId: null,
        toAccountId: budget.id,
        cardId: null,
        memo: "",
        recurringRuleId: null,
      })
    ).rejects.toThrow(/invalid transaction/);
  });

  it("不変条件2: type ごとの from/to 制約に反する取引は保存を拒否する", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    await expect(
      insertTransaction(db, {
        date: "2026-01-01",
        amount: 1000,
        type: "expense_cash",
        fromAccountId: null,
        toAccountId: budget.id,
        cardId: null,
        memo: "",
        recurringRuleId: null,
      })
    ).rejects.toThrow(/invalid transaction/);
  });

  it("updateTransaction はマージ後の内容を再検証する", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const tx = await insertTransaction(db, {
      date: "2026-01-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });
    await expect(updateTransaction(db, tx.id, { amount: -1 })).rejects.toThrow(/invalid transaction/);

    const updated = await updateTransaction(db, tx.id, { amount: 2000, date: "2026-2-1" });
    expect(updated.amount).toBe(2000);
    expect(updated.date).toBe("2026-02-01");
  });

  it("終了済み予算を参照する既存取引の update を拒否し、取引を変更しない", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const tx = await insertTransaction(db, {
      date: "2026-01-01",
      amount: 1000,
      type: "expense_cash",
      fromAccountId: budget.id,
      toAccountId: null,
      cardId: null,
      memo: "変更前",
      recurringRuleId: null,
    });
    await updateAccount(db, budget.id, { archivedAt: "2026-01-31" });

    await expect(updateTransaction(db, tx.id, { amount: 2000, memo: "変更後" })).rejects.toThrow(
      "終了済みの予算「生活費」を参照する取引は変更できません。先に予算を再開してください。"
    );
    expect(await getTransactionById(db, tx.id)).toEqual(tx);
  });

  it("update 後に終了済み予算を参照する変更を拒否する", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const archivedBudget = await insertAccount(db, {
      name: "終了済み予算",
      type: "budget",
      monthlyBudget: 10000,
      ownerId: null,
      sortOrder: 2,
      archivedAt: "2025-12-31",
    });
    const tx = await insertTransaction(db, {
      date: "2026-01-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });

    await expect(updateTransaction(db, tx.id, { toAccountId: archivedBudget.id })).rejects.toThrow(
      "終了済みの予算「終了済み予算」を参照する取引は変更できません。先に予算を再開してください。"
    );
    expect((await getTransactionById(db, tx.id))?.toAccountId).toBe(budget.id);
  });

  it("終了済み予算を参照する既存取引の softDelete を拒否し、取引を残す", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const tx = await insertTransaction(db, {
      date: "2026-01-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });
    await updateAccount(db, budget.id, { archivedAt: "2026-01-31" });

    await expect(softDeleteTransaction(db, tx.id)).rejects.toThrow(
      "終了済みの予算「生活費」を参照する取引は削除できません。先に予算を再開してください。"
    );
    expect(await getTransactionById(db, tx.id)).toEqual(tx);
  });

  it("不変条件5: 論理削除された取引は listTransactions/getTransactionById に現れない", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const tx = await insertTransaction(db, {
      date: "2026-01-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });
    await softDeleteTransaction(db, tx.id);

    expect(await getTransactionById(db, tx.id)).toBeUndefined();
    expect(await listTransactions(db)).toEqual([]);
    expect(await listTransactionsByAccount(db, budget.id)).toEqual([]);

    const includingDeleted = await getTransactionById(db, tx.id, { includeDeleted: true });
    expect(includingDeleted?.deletedAt).toBeTruthy();
    const allIncludingDeleted = await listTransactions(db, { includeDeleted: true });
    expect(allIncludingDeleted).toHaveLength(1);
  });

  it("listTransactionsByAccount は from/to いずれかに一致する取引を返す", async () => {
    const db = createTestDb();
    const { budget, settlement, card } = await seedAccounts(db);
    const income = await insertTransaction(db, {
      date: "2026-01-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });
    const spend = await insertTransaction(db, {
      date: "2026-01-02",
      amount: 500,
      type: "expense_card",
      fromAccountId: budget.id,
      toAccountId: settlement.id,
      cardId: card.id,
      memo: "",
      recurringRuleId: null,
    });

    const budgetTxs = await listTransactionsByAccount(db, budget.id);
    expect(budgetTxs.map((t) => t.id).sort()).toEqual([income.id, spend.id].sort());

    const settlementTxs = await listTransactionsByAccount(db, settlement.id);
    expect(settlementTxs.map((t) => t.id)).toEqual([spend.id]);
  });
});
