import type { AppDatabase } from "../../db/client";
import { generateId } from "../../db/id";
import { accounts as accountsTable, cards as cardsTable } from "../../db/schema";
import type { Account, Card } from "../../domain/types";
import { eq } from "drizzle-orm";

export type CardSettingsPatch = Partial<Pick<Card, "name" | "closingDay" | "debitDay">>;

export type CreateCardInput = {
  name: string;
  closingDay: number | null;
  debitDay: number;
  sortOrder: number;
};

export type CreatedCardWithSettlement = {
  card: Card;
  settlementAccount: Account;
};

export async function createCardWithSettlementAccount(
  db: AppDatabase,
  input: CreateCardInput
): Promise<CreatedCardWithSettlement> {
  const now = new Date().toISOString();
  const settlementAccount: Account = {
    id: generateId(),
    name: `${input.name} 支払準備`,
    type: "card_settlement",
    monthlyBudget: 0,
    ownerId: null,
    sortOrder: input.sortOrder,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const card: Card = {
    id: generateId(),
    name: input.name,
    settlementAccountId: settlementAccount.id,
    closingDay: input.closingDay,
    debitDay: input.debitDay,
  };

  // AppDatabase は sync driver のため、transaction callback 内では Promise を返さず
  // 各 insert を同期実行する。カード作成失敗時は決済口座の insert もロールバックされる。
  db.transaction((tx) => {
    tx.insert(accountsTable).values(settlementAccount).run();
    tx.insert(cardsTable).values(card).run();
  });

  return { card, settlementAccount };
}

export async function updateCardSettings(
  db: AppDatabase,
  id: string,
  patch: CardSettingsPatch
): Promise<Card> {
  if ("settlementAccountId" in patch) {
    throw new Error("カードの支払準備口座は変更できません");
  }
  let updated: Card | undefined;
  db.transaction((tx) => {
    const existing = tx.select().from(cardsTable).where(eq(cardsTable.id, id)).get();
    if (!existing) throw new Error(`card not found: ${id}`);
    const settlementAccount = tx
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, existing.settlementAccountId))
      .get();
    if (!settlementAccount || settlementAccount.type !== "card_settlement") {
      throw new Error("カードの支払準備口座が見つかりません");
    }

    tx.update(cardsTable).set(patch).where(eq(cardsTable.id, id)).run();
    if (patch.name !== undefined) {
      tx.update(accountsTable)
        .set({ name: `${patch.name} 支払準備`, updatedAt: new Date().toISOString() })
        .where(eq(accountsTable.id, existing.settlementAccountId))
        .run();
    }
    updated = {
      ...existing,
      ...patch,
    } as Card;
  });
  if (!updated) throw new Error(`card update did not complete: ${id}`);
  return updated;
}
