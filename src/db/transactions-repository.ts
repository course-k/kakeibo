// transactions の永続化。ドメイン型（Transaction）と DB 行の相互変換を担う。
// 保存前に validateTransaction（不変条件 1・2）を通す。論理削除（deleted_at）済みの
// 取引はデフォルトのクエリから常に除外する（不変条件 5）。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 transactions / §2.3 不変条件 1・2・5
import { and, asc, eq, isNull } from "drizzle-orm";
import { deriveBalance } from "../domain/balance";
import { validateTransaction } from "../domain/validate-transaction";
import type { Account, Transaction } from "../domain/types";
import { listAccounts } from "./accounts-repository";
import { listCards } from "./cards-repository";
import type { AppDatabase } from "./client";
import { generateId } from "./id";
import { normalizeIsoDate } from "./normalize-date";
import { accounts as accountsTable, transactions } from "./schema";

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

function assertValidAgainst(
  tx: Pick<Transaction, "amount" | "type" | "fromAccountId" | "toAccountId" | "cardId">,
  accounts: Account[],
  cards: Awaited<ReturnType<typeof listCards>>
): void {
  const result = validateTransaction(tx, accounts, cards);
  if (!result.ok) {
    throw new Error(`invalid transaction: ${result.reason}`);
  }
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
  assertValidAgainst(tx, accounts, cards);
}

type AccountReferences = Pick<Transaction, "fromAccountId" | "toAccountId">;

/**
 * 終了済み予算は通常画面から隠れるため、それを参照する既存取引を変更すると
 * ユーザーから見えない残高が動いてしまう。更新・削除の境界で必ず拒否する。
 */
async function assertNoArchivedBudgetReferences(
  db: AppDatabase,
  references: AccountReferences,
  action: "変更" | "削除"
): Promise<void> {
  const accounts = await listAccounts(db, { includeArchived: true });
  const byId = new Map<string, Account>(accounts.map((account) => [account.id, account]));
  const referencedIds = [references.fromAccountId, references.toAccountId].filter(
    (id): id is string => id !== null
  );
  const archivedBudget = referencedIds
    .map((id) => byId.get(id))
    .find((account) => account?.type === "budget" && account.archivedAt !== null);

  if (archivedBudget) {
    throw new Error(
      `終了済みの予算「${archivedBudget.name}」を参照する取引は${action}できません。先に予算を再開してください。`
    );
  }
}

export type NewTransactionInput = Omit<
  Transaction,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
> & { id?: string };

function buildTransactionRow(input: NewTransactionInput, now: string): TransactionRow {
  return {
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
}

/** 複数取引を全件検証後、1つのSQLite transactionで保存する。 */
export async function insertTransactionsAtomically(
  db: AppDatabase,
  inputs: NewTransactionInput[]
): Promise<Transaction[]> {
  if (inputs.length === 0) return [];
  const [accountList, cardList] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listCards(db),
  ]);
  for (const input of inputs) assertValidAgainst(input, accountList, cardList);

  const now = new Date().toISOString();
  const rows = inputs.map((input) => buildTransactionRow(input, now));
  db.transaction((tx) => {
    const activeTransactions = tx
      .select()
      .from(transactions)
      .where(isNull(transactions.deletedAt))
      .all()
      .map(toDomain);
    // 日付単位の残高では同日の非transfer取引もすべて反映されるため、
    // DBのルール列順に依存しないようbatch内の非transferを先に計算対象へ含める。
    const balanceTransactions = [
      ...activeTransactions,
      ...rows.filter((row) => row.type !== "transfer").map(toDomain),
    ];

    for (const row of rows.filter((candidate) => candidate.type !== "transfer")) {
      tx.insert(transactions).values(row).run();
    }

    const transfersByDate = new Map<string, TransactionRow[]>();
    for (const row of rows
      .filter((candidate) => candidate.type === "transfer")
      .sort((a, b) => a.date.localeCompare(b.date))) {
      const sameDay = transfersByDate.get(row.date) ?? [];
      sameDay.push(row);
      transfersByDate.set(row.date, sameDay);
    }
    for (const sameDayRows of transfersByDate.values()) {
      for (const row of sameDayRows) {
        const fromAccount = tx
          .select()
          .from(accountsTable)
          .where(eq(accountsTable.id, row.fromAccountId as string))
          .get();
        const toAccount = tx
          .select()
          .from(accountsTable)
          .where(eq(accountsTable.id, row.toAccountId as string))
          .get();
        if (
          !fromAccount ||
          !toAccount ||
          fromAccount.type !== "budget" ||
          toAccount.type !== "budget"
        ) {
          throw new Error("invalid transfer accounts");
        }
        if (fromAccount.archivedAt !== null || toAccount.archivedAt !== null) {
          throw new Error("終了済みの予算には移動できません");
        }
      }
      const sameDayTransactions = sameDayRows.map(toDomain);
      const afterSameDay = [...balanceTransactions, ...sameDayTransactions];
      const fromAccountIds = new Set(
        sameDayRows.map((row) => row.fromAccountId as string)
      );
      const hasNegativeBalance = [...fromAccountIds].some(
        (accountId) => deriveBalance(accountId, afterSameDay, sameDayRows[0].date) < 0
      );
      if (hasNegativeBalance) {
        throw new Error(
          "移動元の残高が不足しています。同日の予算移動を成立させられません"
        );
      }
      for (const row of sameDayRows) {
        tx.insert(transactions).values(row).run();
        balanceTransactions.push(toDomain(row));
      }
    }
  });
  return rows.map(toDomain);
}

export async function insertTransaction(
  db: AppDatabase,
  input: NewTransactionInput
): Promise<Transaction> {
  const [created] = await insertTransactionsAtomically(db, [input]);
  return created;
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
  if (existing.type === "transfer" || merged.type === "transfer") {
    throw new Error("振替は直接変更できません。削除して正しい内容を記録してください");
  }
  if (
    patch.recurringRuleId !== undefined &&
    patch.recurringRuleId !== existing.recurringRuleId
  ) {
    throw new Error("定期取引との関連は直接変更できません");
  }
  if (existing.recurringRuleId !== null && patch.date !== undefined) {
    const normalizedDate = normalizeIsoDate(patch.date);
    if (normalizedDate.slice(0, 7) !== existing.date.slice(0, 7)) {
      throw new Error("定期取引は別の月へ移動できません");
    }
  }
  await assertNoArchivedBudgetReferences(db, existing, "変更");
  await assertNoArchivedBudgetReferences(db, merged, "変更");
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
  await assertNoArchivedBudgetReferences(db, existing, "削除");
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
