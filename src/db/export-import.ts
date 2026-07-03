// 全データの JSON エクスポート/インポート。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.3 不変条件 5・6, §3 設定画面
import type { Account, Card, RecurringRule, Transaction } from "../domain/types";
import { listAccounts } from "./accounts-repository";
import { listCards } from "./cards-repository";
import type { AppDatabase } from "./client";
import { listRecurringRules } from "./recurring-rules-repository";
import { accounts, cards, recurringRules, transactions } from "./schema";
import { listTransactions } from "./transactions-repository";

/** エクスポート JSON のスキーマバージョン。互換性のない変更時のみ上げる。 */
export const EXPORT_SCHEMA_VERSION = 1;

export type ExportedData = {
  schemaVersion: number;
  exportedAt: string;
  accounts: Account[];
  cards: Card[];
  /** 論理削除済みは含まない（不変条件 5）。 */
  transactions: Transaction[];
  recurringRules: RecurringRule[];
};

/**
 * 全データを JSON にエクスポートする。
 * archived な口座も含む（アーカイブは論理削除ではなく状態なので、往復一致には必要）。
 * 論理削除済みの取引は含まない（不変条件 5）。
 */
export async function exportData(db: AppDatabase): Promise<ExportedData> {
  const [accountsList, cardsList, transactionsList, recurringRulesList] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listCards(db),
    listTransactions(db),
    listRecurringRules(db),
  ]);
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: accountsList,
    cards: cardsList,
    transactions: transactionsList,
    recurringRules: recurringRulesList,
  };
}

/**
 * エクスポートされたデータから全データを復元する。
 * 既存データは全置き換えする（機種変更・バックアップ復元の用途）。
 * id・created_at・updated_at はエクスポート時点の値をそのまま復元する
 * （不変条件 6: エクスポート→インポートの往復で全データが一致する、を満たすため）。
 */
export async function importData(db: AppDatabase, data: ExportedData): Promise<void> {
  await db.delete(transactions);
  await db.delete(recurringRules);
  await db.delete(cards);
  await db.delete(accounts);

  if (data.accounts.length > 0) {
    await db.insert(accounts).values(
      data.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        monthlyBudget: a.monthlyBudget,
        ownerId: a.ownerId,
        sortOrder: a.sortOrder,
        archivedAt: a.archivedAt,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }))
    );
  }

  if (data.cards.length > 0) {
    await db.insert(cards).values(
      data.cards.map((c) => ({
        id: c.id,
        name: c.name,
        settlementAccountId: c.settlementAccountId,
        closingDay: c.closingDay,
        debitDay: c.debitDay,
      }))
    );
  }

  if (data.transactions.length > 0) {
    await db.insert(transactions).values(
      data.transactions.map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        type: t.type,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        cardId: t.cardId,
        memo: t.memo,
        recurringRuleId: t.recurringRuleId,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        deletedAt: t.deletedAt,
      }))
    );
  }

  if (data.recurringRules.length > 0) {
    await db.insert(recurringRules).values(
      data.recurringRules.map((r) => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        fromAccountId: r.fromAccountId,
        toAccountId: r.toAccountId,
        cardId: r.cardId,
        memo: r.memo,
        dayOfMonth: r.dayOfMonth,
      }))
    );
  }
}
