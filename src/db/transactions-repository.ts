// transactions の永続化。ドメイン型（Transaction）と DB 行の相互変換を担う。
// 保存前に validateTransaction（不変条件 1・2）を通す。論理削除（deleted_at）済みの
// 取引はデフォルトのクエリから常に除外する（不変条件 5）。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 transactions / §2.3 不変条件 1・2・5
import { and, asc, eq, isNull } from "drizzle-orm";
import { validateTransaction } from "../domain/validate-transaction";
import type { Transaction } from "../domain/types";
import { listAccounts } from "./accounts-repository";
import { listCards } from "./cards-repository";
import type { AppDatabase } from "./client";
import { generateId } from "./id";
import { normalizeIsoDate } from "./normalize-date";
import { transactions } from "./schema";

type TransactionRow = typeof transactions.$inferSelect;

function toDomain(row: TransactionRow): Transaction {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    type: row.type as Transaction["type"],
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    cardId: row.cardId,
    memo: row.memo,
    recurringRuleId: row.recurringRuleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** 保存対象の取引を検証する。accounts/cards は DB から都度読み直す（残高キャッシュを持たないのと同じ考え方）。 */
async function assertValid(
  db: AppDatabase,
  tx: Pick<Transaction, "amount" | "type" | "fromAccountId" | "toAccountId" | "cardId">
): Promise<void> {
  const [accounts, cards] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listCards(db),
  ]);
  const result = validateTransaction(tx, accounts, cards);
  if (!result.ok) {
    throw new Error(`invalid transaction: ${result.reason}`);
  }
}

export type NewTransactionInput = Omit<
  Transaction,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
> & { id?: string };

export async function insertTransaction(
  db: AppDatabase,
  input: NewTransactionInput
): Promise<Transaction> {
  await assertValid(db, input);
  const now = new Date().toISOString();
  const row: TransactionRow = {
    id: input.id ?? generateId(),
    date: normalizeIsoDate(input.date),
    amount: input.amount,
    type: input.type,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    cardId: input.cardId,
    memo: input.memo,
    recurringRuleId: input.recurringRuleId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.insert(transactions).values(row);
  return toDomain(row);
}

export type TransactionPatch = Partial<
  Omit<Transaction, "id" | "createdAt" | "updatedAt" | "deletedAt">
>;

export async function updateTransaction(
  db: AppDatabase,
  id: string,
  patch: TransactionPatch
): Promise<Transaction> {
  const existing = await getTransactionRowById(db, id);
  if (!existing) throw new Error(`transaction not found: ${id}`);
  if (existing.deletedAt !== null) {
    throw new Error(`transaction is deleted: ${id}`);
  }
  const merged: Pick<Transaction, "amount" | "type" | "fromAccountId" | "toAccountId" | "cardId"> = {
    amount: patch.amount ?? existing.amount,
    type: (patch.type ?? existing.type) as Transaction["type"],
    fromAccountId: patch.fromAccountId !== undefined ? patch.fromAccountId : existing.fromAccountId,
    toAccountId: patch.toAccountId !== undefined ? patch.toAccountId : existing.toAccountId,
    cardId: patch.cardId !== undefined ? patch.cardId : existing.cardId,
  };
  await assertValid(db, merged);
  const now = new Date().toISOString();
  const values: Partial<TransactionRow> = { ...patch, updatedAt: now };
  if (patch.date !== undefined) {
    values.date = normalizeIsoDate(patch.date);
  }
  await db.update(transactions).set(values).where(eq(transactions.id, id));
  const row = await getTransactionRowById(db, id);
  if (!row) throw new Error(`transaction not found: ${id}`);
  return toDomain(row);
}

/** 論理削除。deleted_at をセットするのみで物理削除はしない（不変条件 5・同期/復元への備え）。 */
export async function softDeleteTransaction(db: AppDatabase, id: string): Promise<void> {
  const existing = await getTransactionRowById(db, id);
  if (!existing) throw new Error(`transaction not found: ${id}`);
  const now = new Date().toISOString();
  await db.update(transactions).set({ deletedAt: now, updatedAt: now }).where(eq(transactions.id, id));
}

async function getTransactionRowById(
  db: AppDatabase,
  id: string
): Promise<TransactionRow | undefined> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id));
  return rows[0];
}

/**
 * 取引を取得する。デフォルトは論理削除済みを除外する（不変条件 5）。
 * includeDeleted: true を指定した場合のみ、復元 UI 等の用途で削除済みも含める。
 */
export async function getTransactionById(
  db: AppDatabase,
  id: string,
  options: { includeDeleted?: boolean } = {}
): Promise<Transaction | undefined> {
  const row = await getTransactionRowById(db, id);
  if (!row) return undefined;
  if (row.deletedAt !== null && !options.includeDeleted) return undefined;
  return toDomain(row);
}

/**
 * 取引一覧。デフォルトは論理削除済みを除外する（不変条件 5：
 * 残高・集計・エクスポートに論理削除済みが一切現れないことをクエリ側で保証する）。
 */
export async function listTransactions(
  db: AppDatabase,
  options: { includeDeleted?: boolean } = {}
): Promise<Transaction[]> {
  if (options.includeDeleted) {
    const rows = await db
      .select()
      .from(transactions)
      .orderBy(asc(transactions.date), asc(transactions.id));
    return rows.map(toDomain);
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(isNull(transactions.deletedAt))
    .orderBy(asc(transactions.date), asc(transactions.id));
  return rows.map(toDomain);
}

export async function listTransactionsByAccount(
  db: AppDatabase,
  accountId: string
): Promise<Transaction[]> {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.fromAccountId, accountId)
      )
    );
  const toRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.toAccountId, accountId)
      )
    );
  const byId = new Map<string, TransactionRow>();
  for (const row of [...rows, ...toRows]) byId.set(row.id, row);
  return Array.from(byId.values()).map(toDomain);
}
