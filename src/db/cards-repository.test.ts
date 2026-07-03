import { describe, expect, it } from "vitest";
import { insertAccount } from "./accounts-repository";
import { getCardById, insertCard, listCards, updateCard } from "./cards-repository";
import { createTestDb } from "./test-utils";

describe("cards-repository", () => {
  it("insert したカードを id で取得できる", async () => {
    const db = createTestDb();
    const settlement = await insertAccount(db, {
      name: "カードA決済口座",
      type: "card_settlement",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    const card = await insertCard(db, {
      name: "カードA",
      settlementAccountId: settlement.id,
      closingDay: 15,
      debitDay: 27,
    });
    const found = await getCardById(db, card.id);
    expect(found).toEqual(card);

    const all = await listCards(db);
    expect(all).toEqual([card]);
  });

  it("updateCard は指定したフィールドのみ更新する", async () => {
    const db = createTestDb();
    const settlement = await insertAccount(db, {
      name: "カードA決済口座",
      type: "card_settlement",
      monthlyBudget: 0,
      ownerId: null,
      sortOrder: 0,
      archivedAt: null,
    });
    const card = await insertCard(db, {
      name: "カードA",
      settlementAccountId: settlement.id,
      closingDay: null,
      debitDay: 27,
    });
    const updated = await updateCard(db, card.id, { closingDay: 20 });
    expect(updated.closingDay).toBe(20);
    expect(updated.name).toBe("カードA");
  });
});
