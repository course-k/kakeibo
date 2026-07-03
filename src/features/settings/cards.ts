import { insertAccount } from "../../db/accounts-repository";
import { insertCard, updateCard, type CardPatch } from "../../db/cards-repository";
import type { AppDatabase } from "../../db/client";
import type { Account, Card } from "../../domain/types";

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
  const settlementAccount = await insertAccount(db, {
    name: `${input.name} 決済口座`,
    type: "card_settlement",
    monthlyBudget: 0,
    ownerId: null,
    sortOrder: input.sortOrder,
    archivedAt: null,
  });
  const card = await insertCard(db, {
    name: input.name,
    settlementAccountId: settlementAccount.id,
    closingDay: input.closingDay,
    debitDay: input.debitDay,
  });
  return { card, settlementAccount };
}

export async function updateCardSettings(
  db: AppDatabase,
  id: string,
  patch: CardPatch
): Promise<Card> {
  return updateCard(db, id, patch);
}
