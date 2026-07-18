import { describe, expect, it } from "vitest";

import { insertCategory, listCategories, updateCategory } from "./categories-repository";
import { createTestDb } from "./test-utils";

describe("categories-repository", () => {
  it("migrationで収入・支出の初期カテゴリを用意する", async () => {
    const categories = await listCategories(createTestDb());
    expect(categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "default-expense-other", kind: "expense" }),
      expect.objectContaining({ id: "default-income-other", kind: "income" }),
    ]));
  });

  it("カテゴリを追加し、履歴を壊さずアーカイブできる", async () => {
    const db = createTestDb();
    const category = await insertCategory(db, { name: "給与", kind: "income", sortOrder: 0 });
    await updateCategory(db, category.id, { archivedAt: "2026-07-18" });

    expect((await listCategories(db)).some((item) => item.id === category.id)).toBe(false);
    expect(await listCategories(db, { includeArchived: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: category.id, archivedAt: "2026-07-18" })]),
    );
  });

  it("同じ種別の有効カテゴリ名は重複させない", async () => {
    const db = createTestDb();
    await insertCategory(db, { name: "給与", kind: "income", sortOrder: 0 });
    await expect(insertCategory(db, { name: "給与", kind: "income", sortOrder: 1 }))
      .rejects.toThrow("同じ名前のカテゴリがあります");
  });
});
