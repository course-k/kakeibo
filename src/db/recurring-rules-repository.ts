// recurring_rules の永続化。ドメイン型（RecurringRule）と DB 行の相互変換を担う。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 recurring_rules
import { eq } from "drizzle-orm";
import type { RecurringRule } from "../domain/types";
import { listCategories } from "./categories-repository";
import type { AppDatabase } from "./client";
import { generateId } from "./id";
import { recurringRules } from "./schema";

type RecurringRuleRow = typeof recurringRules.$inferSelect;

function toDomain(row: RecurringRuleRow): RecurringRule {
  return {
    id: row.id,
    ruleKind: row.ruleKind as RecurringRule["ruleKind"],
    type: row.type as RecurringRule["type"],
    amount: row.amount,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    cardId: row.cardId,
    categoryId: row.categoryId,
    memo: row.memo,
    dayOfMonth: row.dayOfMonth,
  };
}

export type NewRecurringRuleInput = Omit<RecurringRule, "id"> & { id?: string };

async function assertValidRule(db: AppDatabase, rule: Omit<RecurringRule, "id">): Promise<void> {
  if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31) {
    throw new Error("毎月の日付は1〜31で入力してください");
  }
  if (rule.ruleKind !== undefined && rule.ruleKind !== "user" && rule.ruleKind !== "budget_allocation") {
    throw new Error("定期記録の種別が不正です");
  }
  const categoryList = await listCategories(db, { includeArchived: true });
  const expectedKind =
    rule.type === "income"
      ? "income"
      : rule.type === "expense_cash" || rule.type === "expense_card"
        ? "expense"
        : null;
  if (expectedKind === null && rule.categoryId != null) {
    throw new Error("この定期記録にはカテゴリを設定できません");
  }
  if (rule.categoryId != null) {
    const category = categoryList.find((item) => item.id === rule.categoryId);
    if (!category || category.kind !== expectedKind || category.archivedAt !== null) {
      throw new Error("定期記録の種別に合う有効なカテゴリを選択してください");
    }
  }
}

export async function insertRecurringRule(
  db: AppDatabase,
  input: NewRecurringRuleInput
): Promise<RecurringRule> {
  await assertValidRule(db, input);
  const legacyBudgetAllocation =
    input.ruleKind === undefined &&
    input.type === "income" &&
    input.memo === "月初充当" &&
    input.dayOfMonth === 1 &&
    input.fromAccountId === null &&
    input.cardId === null;
  const row: RecurringRuleRow = {
    id: input.id ?? generateId(),
    ruleKind: input.ruleKind ?? (legacyBudgetAllocation ? "budget_allocation" : "user"),
    type: input.type,
    amount: input.amount,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    cardId: input.cardId,
    categoryId: input.categoryId ?? null,
    memo: input.memo,
    dayOfMonth: input.dayOfMonth,
  };
  await db.insert(recurringRules).values(row);
  return toDomain(row);
}

export type RecurringRulePatch = Partial<Omit<RecurringRule, "id">>;

export async function updateRecurringRule(
  db: AppDatabase,
  id: string,
  patch: RecurringRulePatch
): Promise<RecurringRule> {
  const current = await getRecurringRuleById(db, id);
  if (!current) throw new Error(`recurring rule not found: ${id}`);
  await assertValidRule(db, { ...current, ...patch });
  await db.update(recurringRules).set(patch).where(eq(recurringRules.id, id));
  const row = await getRecurringRuleRowById(db, id);
  if (!row) throw new Error(`recurring rule not found: ${id}`);
  return toDomain(row);
}

async function getRecurringRuleRowById(
  db: AppDatabase,
  id: string
): Promise<RecurringRuleRow | undefined> {
  const rows = await db.select().from(recurringRules).where(eq(recurringRules.id, id));
  return rows[0];
}

export async function getRecurringRuleById(
  db: AppDatabase,
  id: string
): Promise<RecurringRule | undefined> {
  const row = await getRecurringRuleRowById(db, id);
  return row ? toDomain(row) : undefined;
}

export async function deleteRecurringRule(db: AppDatabase, id: string): Promise<void> {
  await db.delete(recurringRules).where(eq(recurringRules.id, id));
}

export async function listRecurringRules(db: AppDatabase): Promise<RecurringRule[]> {
  const rows = await db.select().from(recurringRules);
  return rows.map(toDomain);
}
