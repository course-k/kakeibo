// 全データの JSON エクスポート/インポート。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.3 不変条件 5・6, §3 設定画面
import type { Account, Card, RecurringRule, Transaction } from "../domain/types";
import { listAccounts } from "./accounts-repository";
import { listCards } from "./cards-repository";
import type { AppDatabase } from "./client";
import { normalizeIsoDate } from "./normalize-date";
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
 *
 * v1 の import 境界方針: インポートは「アプリ自身が生成したバックアップの復元」を
 * 対象とし、外部由来 JSON の完全な再検証（validateTransaction の再適用）は行わない。
 * ただし次の 2 点は必ず保証する:
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
export async function importData(db: AppDatabase, data: ExportedData): Promise<void> {
  db.transaction((tx) => {
    tx.delete(transactions).run();
    tx.delete(recurringRules).run();
    tx.delete(cards).run();
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
            memo: r.memo,
            dayOfMonth: r.dayOfMonth,
          }))
        )
        .run();
    }
  });
}
