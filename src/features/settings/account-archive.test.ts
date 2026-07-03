import { describe, expect, it } from "vitest";
import type { Transaction } from "../../domain/types";
import { canArchiveAccount } from "./account-archive";

function tx(
  id: string,
  amount: number,
  fromAccountId: string | null,
  toAccountId: string | null
): Transaction {
  return {
    id,
    date: "2026-07-03",
    amount,
    type: "adjustment",
    fromAccountId,
    toAccountId,
    cardId: null,
    memo: "",
    recurringRuleId: null,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("canArchiveAccount", () => {
  it("deriveBalance で残高 0 の口座だけアーカイブ可能にする", () => {
    expect(canArchiveAccount("budget-1", [tx("in", 1000, null, "budget-1"), tx("out", 1000, "budget-1", null)])).toBe(true);
    expect(canArchiveAccount("budget-1", [tx("in", 1000, null, "budget-1")])).toBe(false);
  });
});
