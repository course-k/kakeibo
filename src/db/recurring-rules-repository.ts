// recurring_rules の永続化。ドメイン型（RecurringRule）と DB 行の相互変換を担う。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 recurring_rules
import { eq } from "drizzle-orm";
import type { RecurringRule } from "../domain/types";
import type { AppDatabase } from "./client";
import { generateId } from "./id";
import { recurringRules } from "./schema";

type RecurringRuleRow = typeof recurringRules.$inferSelect;

function toDomain(row: RecurringRuleRow): RecurringRule {
  return {
    id: row.id,
    type: row.type as RecurringRule["type"],
    amount: row.amount,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    cardId: row.cardId,
    memo: row.memo,
    dayOfMonth: row.dayOfMonth,
  };
}

export type NewRecurringRuleInput = Omit<RecurringRule, "id"> & { id?: string };

export async function insertRecurringRule(
  db: AppDatabase,
  input: NewRecurringRuleInput
): Promise<RecurringRule> {
  const row: RecurringRuleRow = {
    id: input.id ?? generateId(),
    type: input.type,
    amount: input.amount,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    cardId: input.cardId,
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
