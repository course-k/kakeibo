import { describe, expect, it } from "vitest";
import type { Transaction } from "../../domain/types";
import { canArchiveAccount } from "./account-archive";

function tx(
  id: string,
  amount: number,
  fromAccountId: string | null,
  toAccountId: string | null,
  date = "2026-07-03",
  deletedAt: string | null = null,
): Transaction {
  return {
    id,
    date,
    amount,
    type: "adjustment",
    fromAccountId,
    toAccountId,
    cardId: null,
    memo: "",
    recurringRuleId: null,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    deletedAt,
  };
}

describe("canArchiveAccount", () => {
  it("基準日現在の残高が0で未来の有効取引もない場合だけ終了可能にする", () => {
    const settled = [
      tx("in", 1000, null, "budget-1"),
      tx("out", 1000, "budget-1", null),
    ];
    expect(canArchiveAccount("budget-1", settled, "2026-07-03")).toBe(true);
    expect(
      canArchiveAccount("budget-1", [tx("in", 1000, null, "budget-1")], "2026-07-03"),
    ).toBe(false);
    expect(
      canArchiveAccount(
        "budget-1",
        [...settled, tx("future", 500, "budget-1", null, "2026-07-04")],
        "2026-07-03",
      ),
    ).toBe(false);
  });

  it("論理削除済みの未来取引は終了を妨げない", () => {
    expect(
      canArchiveAccount(
        "budget-1",
        [tx("future", 500, "budget-1", null, "2026-07-04", "2026-07-03T12:00:00Z")],
        "2026-07-03",
      ),
    ).toBe(true);
  });
});
