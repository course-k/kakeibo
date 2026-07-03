import { describe, expect, it } from "vitest";
import { listAccounts } from "../../db/accounts-repository";
import { listCards } from "../../db/cards-repository";
import { createTestDb } from "../../db/test-utils";
import { createCardWithSettlementAccount } from "./cards";

describe("createCardWithSettlementAccount", () => {
  it("card_settlement 口座を作成し settlementAccountId でカードへ紐づける", async () => {
    const db = createTestDb();
    const result = await createCardWithSettlementAccount(db, {
      name: "カードA",
      closingDay: 15,
      debitDay: 27,
      sortOrder: 10,
    });

    expect(result.settlementAccount.type).toBe("card_settlement");
    expect(result.settlementAccount.name).toBe("カードA 決済口座");
    expect(result.card.settlementAccountId).toBe(result.settlementAccount.id);

    const accounts = await listAccounts(db, { includeArchived: true });
    const cards = await listCards(db);
    expect(accounts.filter((account) => account.type === "card_settlement")).toHaveLength(1);
    expect(cards).toEqual([result.card]);
  });
});
