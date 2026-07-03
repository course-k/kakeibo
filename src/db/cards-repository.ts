// cards の永続化。ドメイン型（Card）と DB 行の相互変換を担う。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 cards
import { eq } from "drizzle-orm";
import type { Card } from "../domain/types";
import type { AppDatabase } from "./client";
import { generateId } from "./id";
import { cards } from "./schema";

type CardRow = typeof cards.$inferSelect;

function toDomain(row: CardRow): Card {
  return {
    id: row.id,
    name: row.name,
    settlementAccountId: row.settlementAccountId,
    closingDay: row.closingDay,
    debitDay: row.debitDay,
  };
}

export type NewCardInput = Omit<Card, "id"> & { id?: string };

export async function insertCard(db: AppDatabase, input: NewCardInput): Promise<Card> {
  const row: CardRow = {
    id: input.id ?? generateId(),
    name: input.name,
    settlementAccountId: input.settlementAccountId,
    closingDay: input.closingDay,
    debitDay: input.debitDay,
  };
  await db.insert(cards).values(row);
  return toDomain(row);
}

export type CardPatch = Partial<Omit<Card, "id">>;

export async function updateCard(db: AppDatabase, id: string, patch: CardPatch): Promise<Card> {
  await db.update(cards).set(patch).where(eq(cards.id, id));
  const row = await getCardRowById(db, id);
  if (!row) throw new Error(`card not found: ${id}`);
  return toDomain(row);
}

async function getCardRowById(db: AppDatabase, id: string): Promise<CardRow | undefined> {
  const rows = await db.select().from(cards).where(eq(cards.id, id));
  return rows[0];
}

export async function getCardById(db: AppDatabase, id: string): Promise<Card | undefined> {
  const row = await getCardRowById(db, id);
  return row ? toDomain(row) : undefined;
}

export async function listCards(db: AppDatabase): Promise<Card[]> {
  const rows = await db.select().from(cards);
  return rows.map(toDomain);
}
