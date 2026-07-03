import { describe, expect, it } from "vitest";
import { getAccountById, insertAccount, listAccounts, updateAccount } from "./accounts-repository";
import { createTestDb } from "./test-utils";

describe("accounts-repository", () => {
  it("insert したアカウントを id で取得できる", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      name: "生活費",
      type: "budget",
      monthlyBudget: 50000,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    expect(account.id).toBeTruthy();
    expect(account.createdAt).toBeTruthy();
    expect(account.updatedAt).toBe(account.createdAt);

    const found = await getAccountById(db, account.id);
    expect(found).toEqual(account);
  });

  it("listAccounts はデフォルトでアーカイブ済みを除外する", async () => {
    const db = createTestDb();
    const active = await insertAccount(db, {
      name: "生活費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    const archived = await insertAccount(db, {
      name: "旧口座",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 1,
      archivedAt: "2026-01-01",
    });

    const activeOnly = await listAccounts(db);
    expect(activeOnly.map((a) => a.id)).toEqual([active.id]);

    const all = await listAccounts(db, { includeArchived: true });
    expect(all.map((a) => a.id).sort()).toEqual([active.id, archived.id].sort());
  });

  it("updateAccount は updatedAt を更新し archivedAt のゼロ埋め正規化を行う", async () => {
    const db = createTestDb();
    const account = await insertAccount(db, {
      name: "生活費",
      type: "budget",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    const updated = await updateAccount(db, account.id, { archivedAt: "2026-7-3" });
    expect(updated.archivedAt).toBe("2026-07-03");
    expect(updated.createdAt).toBe(account.createdAt);
  });
});
