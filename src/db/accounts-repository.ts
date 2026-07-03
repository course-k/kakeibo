// accounts の永続化。ドメイン型（Account）と DB 行の相互変換を担う。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 accounts
import { asc, eq } from "drizzle-orm";
import type { Account } from "../domain/types";
import type { AppDatabase } from "./client";
import { generateId } from "./id";
import { normalizeIsoDate } from "./normalize-date";
import { accounts } from "./schema";

type AccountRow = typeof accounts.$inferSelect;

function toDomain(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Account["type"],
    monthlyBudget: row.monthlyBudget,
    ownerId: row.ownerId,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type NewAccountInput = Omit<Account, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export async function insertAccount(db: AppDatabase, input: NewAccountInput): Promise<Account> {
  const now = new Date().toISOString();
  const row: AccountRow = {
    id: input.id ?? generateId(),
    name: input.name,
    type: input.type,
    monthlyBudget: input.monthlyBudget,
    ownerId: input.ownerId,
    sortOrder: input.sortOrder,
    archivedAt: input.archivedAt ? normalizeIsoDate(input.archivedAt) : null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(accounts).values(row);
  return toDomain(row);
}

export type AccountPatch = Partial<
  Omit<Account, "id" | "createdAt" | "updatedAt">
>;

export async function updateAccount(
  db: AppDatabase,
  id: string,
  patch: AccountPatch
): Promise<Account> {
  const now = new Date().toISOString();
  const values: Partial<AccountRow> = { ...patch, updatedAt: now };
  if (patch.archivedAt !== undefined) {
    values.archivedAt = patch.archivedAt ? normalizeIsoDate(patch.archivedAt) : null;
  }
  await db.update(accounts).set(values).where(eq(accounts.id, id));
  const row = await getAccountRowById(db, id);
  if (!row) throw new Error(`account not found: ${id}`);
  return toDomain(row);
}

async function getAccountRowById(db: AppDatabase, id: string): Promise<AccountRow | undefined> {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id));
  return rows[0];
}

export async function getAccountById(db: AppDatabase, id: string): Promise<Account | undefined> {
  const row = await getAccountRowById(db, id);
  return row ? toDomain(row) : undefined;
}

export async function listAccounts(
  db: AppDatabase,
  options: { includeArchived?: boolean } = {}
): Promise<Account[]> {
  const rows = await db.select().from(accounts).orderBy(asc(accounts.sortOrder));
  const domainRows = rows.map(toDomain);
  if (options.includeArchived) return domainRows;
  return domainRows.filter((a) => a.archivedAt === null);
}
