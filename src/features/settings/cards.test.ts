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
    expect(result.settlementAccount.name).toBe("カードA 支払準備");
    expect(result.card.settlementAccountId).toBe(result.settlementAccount.id);

    const accounts = await listAccounts(db, { includeArchived: true });
    const cards = await listCards(db);
    expect(accounts.filter((account) => account.type === "card_settlement")).toHaveLength(1);
    expect(cards).toEqual([result.card]);
  });

  it("カード insert が失敗した場合は決済口座も残さない", async () => {
    const db = createTestDb();

    await expect(
      createCardWithSettlementAccount(db, {
        // 実行時の NOT NULL 制約違反で後段の cards insert を失敗させる。
        // 先行する決済口座名はテンプレート文字列化されるため accounts insert は成功する。
        name: null as unknown as string,
        closingDay: 15,
        debitDay: 27,
        sortOrder: 10,
      })
    ).rejects.toThrow();

    expect(await listAccounts(db, { includeArchived: true })).toEqual([]);
    expect(await listCards(db)).toEqual([]);
  });
});
