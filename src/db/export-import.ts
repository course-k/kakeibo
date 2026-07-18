// 全データの JSON エクスポート/インポート。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.3 不変条件 5・6, §3 設定画面
import type { Account, Card, Category, CategoryKind, RecurringRule, Transaction } from "../domain/types";
import { validateTransaction } from "../domain/validate-transaction";
import { listAccounts } from "./accounts-repository";
import { listCards } from "./cards-repository";
import { listCategories } from "./categories-repository";
import type { AppDatabase } from "./client";
import { normalizeIsoDate } from "./normalize-date";
import { listRecurringRules } from "./recurring-rules-repository";
import { accounts, cards, categories, recurringRules, transactions } from "./schema";
import { listTransactions } from "./transactions-repository";

/** エクスポート JSON のスキーマバージョン。互換性のない変更時のみ上げる。 */
export const EXPORT_SCHEMA_VERSION = 2;

export type ExportedData = {
  schemaVersion: number;
  exportedAt: string;
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  /** 論理削除済み tombstone も含む（復元後の再生成を防ぐため）。 */
  transactions: Transaction[];
  recurringRules: RecurringRule[];
};

/**
 * 全データを JSON にエクスポートする。
 * archived な口座も含む（アーカイブは論理削除ではなく状態なので、往復一致には必要）。
 * 論理削除済みの取引も tombstone として含む。定期取引の削除履歴を失うと、
 * 復元後の月次実取引化で同じ取引が復活するためである。
 */
export async function exportData(db: AppDatabase): Promise<ExportedData> {
  const [accountsList, cardsList, categoriesList, transactionsList, recurringRulesList] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listCards(db),
    listCategories(db, { includeArchived: true }),
    listTransactions(db, { includeDeleted: true }),
    listRecurringRules(db),
  ]);
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: accountsList,
    cards: cardsList,
    categories: categoriesList,
    transactions: transactionsList,
    recurringRules: recurringRulesList,
  };
}

/**
 * エクスポートされたデータから全データを復元する。
 * 既存データは全置き換えする（機種変更・バックアップ復元の用途）。
 *
 * 書き込み前に外形・参照整合性・ドメイン不変条件をすべて検証する。不正な JSON は
 * DB transaction を開始する前に拒否するため、既存データを変更しない。
 * さらに次の 2 点を保証する:
 *  (a) 全置き換えを 1 つの DB トランザクションで原子的に行う（削除〜再挿入の途中で
 *      失敗しても、既存データが消えたまま残ることはない）
 *  (b) 日付（transactions.date / accounts.archivedAt）を取り込み境界で
 *      'YYYY-MM-DD' ゼロ埋め正規化する
 *
 * id・created_at・updated_at はエクスポート時点の値をそのまま復元する
 * （不変条件 6: 論理削除を除く可視データはエクスポート→インポートの往復で一致する、
 * を満たすため）。
 *
 * 実装メモ: AppDatabase は resultKind='sync' の drizzle インスタンス（expo-sqlite /
 * better-sqlite3 とも同期ドライバ）。両者の db.transaction() はコールバックを
 * 同期関数として呼び出し、Promise を返すとそのまま commit されてしまう
 * （better-sqlite3 は明示的に例外を投げる）。そのためコールバック内は async/await を
 * 使わず、各クエリビルダの同期実行メソッド .run() を直接呼ぶ。
 */
export async function importData(db: AppDatabase, input: unknown): Promise<void> {
  const data = parseAndNormalizeExportedData(input);
  db.transaction((tx) => {
    tx.delete(transactions).run();
    tx.delete(recurringRules).run();
    tx.delete(cards).run();
    tx.delete(categories).run();
    tx.delete(accounts).run();

    if (data.accounts.length > 0) {
      tx.insert(accounts)
        .values(
          data.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            monthlyBudget: a.monthlyBudget,
            ownerId: a.ownerId,
            sortOrder: a.sortOrder,
            archivedAt: a.archivedAt ? normalizeIsoDate(a.archivedAt) : null,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
          }))
        )
        .run();
    }

    if (data.categories.length > 0) {
      tx.insert(categories)
        .values(
          data.categories.map((category) => ({
            id: category.id,
            name: category.name,
            kind: category.kind,
            sortOrder: category.sortOrder,
            archivedAt: category.archivedAt ? normalizeIsoDate(category.archivedAt) : null,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
          }))
        )
        .run();
    }

    if (data.cards.length > 0) {
      tx.insert(cards)
        .values(
          data.cards.map((c) => ({
            id: c.id,
            name: c.name,
            settlementAccountId: c.settlementAccountId,
            closingDay: c.closingDay,
            debitDay: c.debitDay,
          }))
        )
        .run();
    }

    if (data.transactions.length > 0) {
      tx.insert(transactions)
        .values(
          data.transactions.map((t) => ({
            id: t.id,
            date: normalizeIsoDate(t.date),
            amount: t.amount,
            type: t.type,
            fromAccountId: t.fromAccountId,
            toAccountId: t.toAccountId,
            cardId: t.cardId,
            categoryId: t.categoryId ?? null,
            memo: t.memo,
            recurringRuleId: t.recurringRuleId,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            deletedAt: t.deletedAt,
          }))
        )
        .run();
    }

    if (data.recurringRules.length > 0) {
      tx.insert(recurringRules)
        .values(
          data.recurringRules.map((r) => ({
            id: r.id,
            type: r.type,
            amount: r.amount,
            fromAccountId: r.fromAccountId,
            toAccountId: r.toAccountId,
            cardId: r.cardId,
            categoryId: r.categoryId ?? null,
            ruleKind: r.ruleKind ?? "user",
            memo: r.memo,
            dayOfMonth: r.dayOfMonth,
          }))
        )
        .run();
    }
  });
}

const TRANSACTION_TYPES = new Set<Transaction["type"]>([
  "income",
  "expense_cash",
  "expense_card",
  "transfer",
  "card_debit",
  "adjustment",
]);
const CATEGORY_KINDS = new Set<CategoryKind>(["income", "expense"]);
const LEGACY_CATEGORY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function invalid(path: string, reason: string): never {
  throw new Error(`invalid backup: ${path} ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(path, "must be an object");
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value;
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") invalid(`${path}.${key}`, "must be a string");
  return value;
}

function requireNullableString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  const value = record[key];
  if (value !== null && typeof value !== "string") {
    invalid(`${path}.${key}`, "must be a string or null");
  }
  return value;
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  return record[key] === undefined ? null : requireNullableString(record, key, path);
}

function requireInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid(`${path}.${key}`, "must be a safe integer");
  }
  return value;
}

function requireNullableDay(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 31) {
    invalid(`${path}.${key}`, "must be an integer from 1 to 31 or null");
  }
  return value;
}

function requireTransactionType(
  record: Record<string, unknown>,
  path: string,
): Transaction["type"] {
  const value = requireString(record, "type", path) as Transaction["type"];
  if (!TRANSACTION_TYPES.has(value)) invalid(`${path}.type`, "is unknown");
  return value;
}

function assertUniqueIds(items: { id: string }[], path: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) invalid(path, `contains duplicate id: ${item.id}`);
    ids.add(item.id);
  }
}

function parseAccount(value: unknown, index: number): Account {
  const path = `accounts[${index}]`;
  const row = requireRecord(value, path);
  const type = requireString(row, "type", path);
  if (type !== "budget" && type !== "card_settlement") invalid(`${path}.type`, "is unknown");
  const monthlyBudget = requireInteger(row, "monthlyBudget", path);
  if (monthlyBudget < 0) invalid(`${path}.monthlyBudget`, "must be non-negative");
  const archivedAt = requireNullableString(row, "archivedAt", path);
  if (archivedAt !== null) normalizeIsoDate(archivedAt);
  return {
    id: requireString(row, "id", path),
    name: requireString(row, "name", path),
    type,
    monthlyBudget,
    ownerId: requireNullableString(row, "ownerId", path),
    sortOrder: requireInteger(row, "sortOrder", path),
    archivedAt,
    createdAt: requireString(row, "createdAt", path),
    updatedAt: requireString(row, "updatedAt", path),
  };
}

function parseCard(value: unknown, index: number): Card {
  const path = `cards[${index}]`;
  const row = requireRecord(value, path);
  const debitDay = requireInteger(row, "debitDay", path);
  if (debitDay < 1 || debitDay > 31) invalid(`${path}.debitDay`, "must be from 1 to 31");
  return {
    id: requireString(row, "id", path),
    name: requireString(row, "name", path),
    settlementAccountId: requireString(row, "settlementAccountId", path),
    closingDay: requireNullableDay(row, "closingDay", path),
    debitDay,
  };
}

function parseCategory(value: unknown, index: number): Category {
  const path = `categories[${index}]`;
  const row = requireRecord(value, path);
  const kind = requireString(row, "kind", path) as CategoryKind;
  if (!CATEGORY_KINDS.has(kind)) invalid(`${path}.kind`, "is unknown");
  const archivedAt = requireNullableString(row, "archivedAt", path);
  if (archivedAt !== null) normalizeIsoDate(archivedAt);
  return {
    id: requireString(row, "id", path),
    name: requireString(row, "name", path),
    kind,
    sortOrder: requireInteger(row, "sortOrder", path),
    archivedAt,
    createdAt: requireString(row, "createdAt", path),
    updatedAt: requireString(row, "updatedAt", path),
  };
}

function parseTransaction(value: unknown, index: number, includeCategory: boolean): Transaction {
  const path = `transactions[${index}]`;
  const row = requireRecord(value, path);
  const date = requireString(row, "date", path);
  normalizeIsoDate(date);
  const deletedAt = requireNullableString(row, "deletedAt", path);
  return {
    id: requireString(row, "id", path),
    date,
    amount: requireInteger(row, "amount", path),
    type: requireTransactionType(row, path),
    fromAccountId: requireNullableString(row, "fromAccountId", path),
    toAccountId: requireNullableString(row, "toAccountId", path),
    cardId: requireNullableString(row, "cardId", path),
    categoryId: includeCategory ? optionalNullableString(row, "categoryId", path) : null,
    memo: requireString(row, "memo", path),
    recurringRuleId: requireNullableString(row, "recurringRuleId", path),
    createdAt: requireString(row, "createdAt", path),
    updatedAt: requireString(row, "updatedAt", path),
    deletedAt,
  };
}

function parseRecurringRule(value: unknown, index: number, includeCategory: boolean): RecurringRule {
  const path = `recurringRules[${index}]`;
  const row = requireRecord(value, path);
  const dayOfMonth = requireInteger(row, "dayOfMonth", path);
  if (dayOfMonth < 1 || dayOfMonth > 31) {
    invalid(`${path}.dayOfMonth`, "must be from 1 to 31");
  }
  const type = requireTransactionType(row, path);
  const memo = requireString(row, "memo", path);
  const rawRuleKind = row.ruleKind;
  const inferredBudgetAllocation =
    type === "income" &&
    memo === "月初充当" &&
    dayOfMonth === 1 &&
    row.fromAccountId === null &&
    row.cardId === null;
  const ruleKind = rawRuleKind === undefined
    ? inferredBudgetAllocation ? "budget_allocation" : "user"
    : rawRuleKind;
  if (ruleKind !== "budget_allocation" && ruleKind !== "user") {
    invalid(`${path}.ruleKind`, "is unknown");
  }
  return {
    id: requireString(row, "id", path),
    ruleKind,
    type,
    amount: requireInteger(row, "amount", path),
    fromAccountId: requireNullableString(row, "fromAccountId", path),
    toAccountId: requireNullableString(row, "toAccountId", path),
    cardId: requireNullableString(row, "cardId", path),
    categoryId: includeCategory ? optionalNullableString(row, "categoryId", path) : null,
    memo,
    dayOfMonth,
  };
}

function parseAndNormalizeExportedData(input: unknown): ExportedData {
  const root = requireRecord(input, "backup");
  if (root.schemaVersion !== 1 && root.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    invalid("schemaVersion", `must equal 1 or ${EXPORT_SCHEMA_VERSION}`);
  }
  const exportedAt = requireString(root, "exportedAt", "backup");
  const isLegacyV1 = root.schemaVersion === 1;

  const parsedAccounts = requireArray(root.accounts, "accounts").map(parseAccount);
  const parsedCards = requireArray(root.cards, "cards").map(parseCard);
  const parsedCategories = isLegacyV1
    ? createLegacyCategories(parsedAccounts)
    : requireArray(root.categories, "categories").map(parseCategory);
  const parsedTransactions = requireArray(root.transactions, "transactions").map((value, index) =>
    parseTransaction(value, index, !isLegacyV1)
  );
  const parsedRules = requireArray(root.recurringRules, "recurringRules").map((value, index) =>
    parseRecurringRule(value, index, !isLegacyV1)
  );
  if (isLegacyV1) {
    for (const transaction of parsedTransactions) {
      transaction.categoryId = legacyCategoryId(transaction);
    }
    for (const rule of parsedRules) {
      rule.categoryId = legacyCategoryId(rule);
    }
  }
  assertUniqueIds(parsedAccounts, "accounts");
  assertUniqueIds(parsedCards, "cards");
  assertUniqueIds(parsedCategories, "categories");
  assertUniqueIds(parsedTransactions, "transactions");
  assertUniqueIds(parsedRules, "recurringRules");

  const accountById = new Map(parsedAccounts.map((account) => [account.id, account]));
  const cardById = new Map(parsedCards.map((card) => [card.id, card]));
  const categoryById = new Map(parsedCategories.map((category) => [category.id, category]));
  const claimedSettlementIds = new Set<string>();
  for (const card of parsedCards) {
    const settlement = accountById.get(card.settlementAccountId);
    if (!settlement || settlement.type !== "card_settlement") {
      invalid(`cards.${card.id}.settlementAccountId`, "must reference a card_settlement account");
    }
    if (claimedSettlementIds.has(card.settlementAccountId)) {
      invalid("cards", `settlement account is shared: ${card.settlementAccountId}`);
    }
    claimedSettlementIds.add(card.settlementAccountId);
  }
  for (const account of parsedAccounts) {
    if (account.type === "card_settlement" && !claimedSettlementIds.has(account.id)) {
      invalid(`accounts.${account.id}`, "card_settlement account must belong to exactly one card");
    }
  }

  const assertReferences = (
    value: Pick<Transaction, "type" | "fromAccountId" | "toAccountId" | "cardId" | "categoryId">,
    path: string,
  ) => {
    if (value.fromAccountId !== null && !accountById.has(value.fromAccountId)) {
      invalid(`${path}.fromAccountId`, "references a missing account");
    }
    if (value.toAccountId !== null && !accountById.has(value.toAccountId)) {
      invalid(`${path}.toAccountId`, "references a missing account");
    }
    if (value.cardId !== null && !cardById.has(value.cardId)) {
      invalid(`${path}.cardId`, "references a missing card");
    }
    const categoryId = value.categoryId ?? null;
    const expectedKind: CategoryKind | null =
      value.type === "income"
        ? "income"
        : value.type === "expense_cash" || value.type === "expense_card"
          ? "expense"
          : null;
    if (categoryId !== null) {
      const category = categoryById.get(categoryId);
      if (!category) invalid(`${path}.categoryId`, "references a missing category");
      if (expectedKind === null) invalid(`${path}.categoryId`, "is not allowed for this transaction type");
      if (category.kind !== expectedKind) {
        invalid(`${path}.categoryId`, `must reference a ${expectedKind} category`);
      }
    }
  };

  parsedRules.forEach((rule, index) => {
    const path = `recurringRules[${index}]`;
    assertReferences(rule, path);
    const validation = validateTransaction(rule, parsedAccounts, parsedCards);
    if (!validation.ok) invalid(path, `violates transaction invariant: ${validation.reason}`);
  });
  parsedTransactions.forEach((transaction, index) => {
    const path = `transactions[${index}]`;
    assertReferences(transaction, path);
    const validation = validateTransaction(transaction, parsedAccounts, parsedCards);
    if (!validation.ok) invalid(path, `violates transaction invariant: ${validation.reason}`);
  });

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    accounts: parsedAccounts,
    cards: parsedCards,
    categories: parsedCategories,
    transactions: parsedTransactions,
    recurringRules: parsedRules,
  };
}

function createLegacyCategories(accountList: Account[]): Category[] {
  const defaults: Category[] = [
    {
      id: "default-expense-other",
      name: "その他支出",
      kind: "expense",
      sortOrder: 1_000_000,
      archivedAt: null,
      createdAt: LEGACY_CATEGORY_TIMESTAMP,
      updatedAt: LEGACY_CATEGORY_TIMESTAMP,
    },
    {
      id: "default-income-other",
      name: "その他収入",
      kind: "income",
      sortOrder: 1_000_000,
      archivedAt: null,
      createdAt: LEGACY_CATEGORY_TIMESTAMP,
      updatedAt: LEGACY_CATEGORY_TIMESTAMP,
    },
  ];
  return [
    ...defaults,
    ...accountList
      .filter((account) => account.type === "budget")
      .map((account) => ({
        id: `legacy-budget-${account.id}`,
        name: account.name,
        kind: "expense" as const,
        sortOrder: account.sortOrder,
        archivedAt: account.archivedAt,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })),
  ];
}

function legacyCategoryId(
  value: Pick<Transaction, "type" | "fromAccountId">
): string | null {
  return (value.type === "expense_cash" || value.type === "expense_card") && value.fromAccountId
    ? `legacy-budget-${value.fromAccountId}`
    : null;
}
