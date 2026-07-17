import { describe, expect, it } from "vitest";
import { insertAccount, updateAccount } from "./accounts-repository";
import { insertCard } from "./cards-repository";
import { insertRecurringRule } from "./recurring-rules-repository";
import { createTestDb } from "./test-utils";
import {
  getTransactionById,
  insertTransaction,
  insertTransactionsAtomically,
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

  it("transfer は保存時点の残高を超える場合に拒否し、取引を残さない", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const destination = await insertAccount(db, {
      name: "予備費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 2,
      archivedAt: null,
    });
    await insertTransaction(db, {
      date: "2026-07-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });

    await expect(
      insertTransaction(db, {
        date: "2026-07-18",
        amount: 1001,
        type: "transfer",
        fromAccountId: budget.id,
        toAccountId: destination.id,
        cardId: null,
        memo: "予算を移動",
        recurringRuleId: null,
      })
    ).rejects.toThrow("移動元の残高が不足しています");

    expect((await listTransactions(db)).filter((transaction) => transaction.type === "transfer")).toEqual([]);
  });

  it("transfer は終了済み予算を参照する場合に拒否する", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const archived = await insertAccount(db, {
      name: "終了済み",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 2,
      archivedAt: "2026-07-01",
    });
    await insertTransaction(db, {
      date: "2026-07-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });

    await expect(
      insertTransaction(db, {
        date: "2026-07-18",
        amount: 500,
        type: "transfer",
        fromAccountId: budget.id,
        toAccountId: archived.id,
        cardId: null,
        memo: "",
        recurringRuleId: null,
      })
    ).rejects.toThrow("終了済みの予算には移動できません");
  });

  it("transfer の更新で残高超過を作れない", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const destination = await insertAccount(db, {
      name: "予備費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 2,
      archivedAt: null,
    });
    await insertTransaction(db, {
      date: "2026-07-01",
      amount: 1000,
      type: "income",
      fromAccountId: null,
      toAccountId: budget.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });
    const transfer = await insertTransaction(db, {
      date: "2026-07-02",
      amount: 500,
      type: "transfer",
      fromAccountId: budget.id,
      toAccountId: destination.id,
      cardId: null,
      memo: "",
      recurringRuleId: null,
    });

    await expect(updateTransaction(db, transfer.id, { amount: 2000 })).rejects.toThrow(
      "振替は直接変更できません"
    );
    expect((await getTransactionById(db, transfer.id))?.amount).toBe(500);
  });

  it("カード支払準備のadjustmentをcardId付きで保存できる", async () => {
    const db = createTestDb();
    const { settlement, card } = await seedAccounts(db);
    const adjustment = await insertTransaction(db, {
      date: "2026-07-02",
      amount: 500,
      type: "adjustment",
      fromAccountId: null,
      toAccountId: settlement.id,
      cardId: card.id,
      memo: "請求差額",
      recurringRuleId: null,
    });

    expect(adjustment.cardId).toBe(card.id);
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

  it("atomic batchのtransferは日付と資金連鎖を解決し、入力順に依存しない", async () => {
    const db = createTestDb();
    const { budget: a } = await seedAccounts(db);
    const b = await insertAccount(db, {
      name: "B", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 2, archivedAt: null,
    });
    const c = await insertAccount(db, {
      name: "C", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 3, archivedAt: null,
    });
    await expect(insertTransactionsAtomically(db, [
      { date: "2026-07-10", amount: 100, type: "transfer", fromAccountId: a.id, toAccountId: c.id, cardId: null, memo: "", recurringRuleId: null },
      { date: "2026-07-05", amount: 100, type: "transfer", fromAccountId: b.id, toAccountId: a.id, cardId: null, memo: "", recurringRuleId: null },
      { date: "2026-07-01", amount: 100, type: "income", fromAccountId: null, toAccountId: b.id, cardId: null, memo: "", recurringRuleId: null },
    ])).resolves.toHaveLength(3);
    expect((await listTransactions(db)).filter((item) => item.type === "transfer")).toHaveLength(2);
  });

  it("atomic batchの同日transferは実行可能な資金連鎖を入力順に関係なく保存する", async () => {
    const db = createTestDb();
    const { budget: a } = await seedAccounts(db);
    const b = await insertAccount(db, {
      name: "B", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 2, archivedAt: null,
    });
    const c = await insertAccount(db, {
      name: "C", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 3, archivedAt: null,
    });
    await expect(insertTransactionsAtomically(db, [
      { date: "2026-07-05", amount: 100, type: "transfer", fromAccountId: a.id, toAccountId: c.id, cardId: null, memo: "", recurringRuleId: null },
      { date: "2026-07-05", amount: 100, type: "transfer", fromAccountId: b.id, toAccountId: a.id, cardId: null, memo: "", recurringRuleId: null },
      { date: "2026-07-01", amount: 100, type: "income", fromAccountId: null, toAccountId: b.id, cardId: null, memo: "", recurringRuleId: null },
    ])).resolves.toHaveLength(3);
  });

  it("同日transferは列順に依存せず原子的に同時適用する", async () => {
    const db = createTestDb();
    const { budget: a } = await seedAccounts(db);
    const b = await insertAccount(db, {
      name: "B", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 2, archivedAt: null,
    });
    const c = await insertAccount(db, {
      name: "C", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 3, archivedAt: null,
    });
    await insertTransaction(db, {
      date: "2026-07-01", amount: 100, type: "income", fromAccountId: null,
      toAccountId: a.id, cardId: null, memo: "", recurringRuleId: null,
    });
    await expect(insertTransactionsAtomically(db, [
      { date: "2026-07-05", amount: 100, type: "transfer", fromAccountId: a.id, toAccountId: b.id, cardId: null, memo: "", recurringRuleId: null },
      { date: "2026-07-05", amount: 100, type: "transfer", fromAccountId: b.id, toAccountId: a.id, cardId: null, memo: "", recurringRuleId: null },
      { date: "2026-07-05", amount: 100, type: "transfer", fromAccountId: a.id, toAccountId: c.id, cardId: null, memo: "", recurringRuleId: null },
    ])).resolves.toHaveLength(3);
  });

  it("多数の同日transferも最終残高が非負なら順序探索せず保存する", async () => {
    const db = createTestDb();
    const { budget: a } = await seedAccounts(db);
    const bridge = await insertAccount(db, {
      name: "bridge", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 2, archivedAt: null,
    });
    const destinations = await Promise.all(
      Array.from({ length: 13 }, (_, index) =>
        insertAccount(db, {
          name: `B${index}`, type: "budget", monthlyBudget: 0, ownerId: null,
          sortOrder: index + 3, archivedAt: null,
        })
      )
    );
    await insertTransaction(db, {
      date: "2026-07-01", amount: 13, type: "income", fromAccountId: null,
      toAccountId: a.id, cardId: null, memo: "", recurringRuleId: null,
    });
    const transfers = [
      ...destinations.map((destination) => ({
        date: "2026-07-05", amount: 1, type: "transfer" as const,
        fromAccountId: a.id, toAccountId: destination.id, cardId: null,
        memo: "", recurringRuleId: null,
      })),
      { date: "2026-07-05", amount: 13, type: "transfer" as const, fromAccountId: a.id, toAccountId: bridge.id, cardId: null, memo: "", recurringRuleId: null },
      { date: "2026-07-05", amount: 13, type: "transfer" as const, fromAccountId: bridge.id, toAccountId: a.id, cardId: null, memo: "", recurringRuleId: null },
    ];
    await expect(insertTransactionsAtomically(db, transfers)).resolves.toHaveLength(15);
  });

  it("同型の同日transferが1件だけ不足するbatchを指数探索せず拒否する", async () => {
    const db = createTestDb();
    const { budget: from } = await seedAccounts(db);
    const to = await insertAccount(db, {
      name: "B", type: "budget", monthlyBudget: 0, ownerId: null, sortOrder: 2, archivedAt: null,
    });
    await insertTransaction(db, {
      date: "2026-07-01", amount: 29, type: "income", fromAccountId: null,
      toAccountId: from.id, cardId: null, memo: "", recurringRuleId: null,
    });
    const repeated = Array.from({ length: 30 }, () => ({
      date: "2026-07-05", amount: 1, type: "transfer" as const,
      fromAccountId: from.id, toAccountId: to.id, cardId: null, memo: "", recurringRuleId: null,
    }));
    await expect(insertTransactionsAtomically(db, repeated)).rejects.toThrow(
      "移動元の残高が不足しています。同日の予算移動を成立させられません"
    );
  });

  it("永続化境界で定期取引の月移動と関連付け変更を拒否する", async () => {
    const db = createTestDb();
    const { budget } = await seedAccounts(db);
    const rule = await insertRecurringRule(db, {
      type: "expense_cash", amount: 500, fromAccountId: budget.id, toAccountId: null,
      cardId: null, memo: "定期", dayOfMonth: 5,
    });
    const recurring = await insertTransaction(db, {
      date: "2026-07-05", amount: 500, type: "expense_cash", fromAccountId: budget.id,
      toAccountId: null, cardId: null, memo: "定期", recurringRuleId: rule.id,
    });
    await expect(updateTransaction(db, recurring.id, { date: "2026-08-05" })).rejects.toThrow(
      "定期取引は別の月へ移動できません"
    );
    await expect(updateTransaction(db, recurring.id, { recurringRuleId: null })).rejects.toThrow(
      "定期取引との関連は直接変更できません"
    );
  });
});
