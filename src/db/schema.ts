// Drizzle スキーマ定義。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1（エンティティ列定義）
//
// 全テーブル UUID（text）主キー。日付・日時は 'YYYY-MM-DD' / ISO 文字列（text）で保持し、
// 正規化（ゼロ埋め）は境界層（src/db/*-repository.ts）が保証する。ここではスキーマの型のみを定義する。
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

/** accounts（口座）。type は 'budget' | 'card_settlement'。 */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  monthlyBudget: integer("monthly_budget").notNull(),
  ownerId: text("owner_id"),
  sortOrder: integer("sort_order").notNull(),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** cards（クレジットカード）。 */
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  settlementAccountId: text("settlement_account_id").notNull(),
  closingDay: integer("closing_day"),
  debitDay: integer("debit_day").notNull(),
});

/** categories（収入・支出の分類）。予算口座とは独立した分析軸。 */
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  sortOrder: integer("sort_order").notNull(),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** transactions（取引）。deleted_at で論理削除する（不変条件 5）。 */
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  fromAccountId: text("from_account_id"),
  toAccountId: text("to_account_id"),
  cardId: text("card_id"),
  categoryId: text("category_id"),
  memo: text("memo").notNull(),
  recurringRuleId: text("recurring_rule_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

/** recurring_rules（定期取引）。取引のテンプレート＋発生日（毎月 N 日）。 */
export const recurringRules = sqliteTable("recurring_rules", {
  id: text("id").primaryKey(),
  ruleKind: text("rule_kind").notNull().default("user"),
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  fromAccountId: text("from_account_id"),
  toAccountId: text("to_account_id"),
  cardId: text("card_id"),
  categoryId: text("category_id"),
  memo: text("memo").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
});
