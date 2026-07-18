import { asc, eq } from "drizzle-orm";
import type { Category, CategoryKind } from "../domain/types";
import type { AppDatabase } from "./client";
import { generateId } from "./id";
import { categories } from "./schema";

type CategoryRow = typeof categories.$inferSelect;

function toDomain(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CategoryKind,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCategories(
  db: AppDatabase,
  options: { includeArchived?: boolean; kind?: CategoryKind } = {},
): Promise<Category[]> {
  const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows
    .map(toDomain)
    .filter((category) => options.includeArchived || category.archivedAt === null)
    .filter((category) => !options.kind || category.kind === options.kind);
}

export async function insertCategory(
  db: AppDatabase,
  input: { name: string; kind: CategoryKind; sortOrder: number; id?: string },
): Promise<Category> {
  const name = input.name.trim();
  if (!name) throw new Error("カテゴリ名を入力してください");
  const duplicate = (await listCategories(db, { includeArchived: true, kind: input.kind })).find(
    (category) => category.name === name && category.archivedAt === null,
  );
  if (duplicate) throw new Error("同じ名前のカテゴリがあります");
  const now = new Date().toISOString();
  const row: CategoryRow = {
    id: input.id ?? generateId(),
    name,
    kind: input.kind,
    sortOrder: input.sortOrder,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(categories).values(row);
  return toDomain(row);
}

export async function updateCategory(
  db: AppDatabase,
  id: string,
  patch: Partial<Pick<Category, "name" | "sortOrder" | "archivedAt">>,
): Promise<Category> {
  const current = (await listCategories(db, { includeArchived: true })).find((category) => category.id === id);
  if (!current) throw new Error("カテゴリが見つかりません");
  const name = patch.name === undefined ? current.name : patch.name.trim();
  if (!name) throw new Error("カテゴリ名を入力してください");
  const duplicate = (await listCategories(db, { includeArchived: true, kind: current.kind })).find(
    (category) => category.id !== id && category.name === name && category.archivedAt === null,
  );
  if (duplicate && (patch.archivedAt === undefined || patch.archivedAt === null)) {
    throw new Error("同じ名前のカテゴリがあります");
  }
  await db
    .update(categories)
    .set({ ...patch, name, updatedAt: new Date().toISOString() })
    .where(eq(categories.id, id));
  const updated = (await listCategories(db, { includeArchived: true })).find((category) => category.id === id);
  if (!updated) throw new Error("カテゴリが見つかりません");
  return updated;
}
