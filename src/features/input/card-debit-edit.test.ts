import { describe, expect, it } from "vitest";
import type { Transaction } from "../../domain/types";
import { buildCardDebitEditPatch, createCardDebitEditState } from "./card-debit-edit";

const debit: Transaction = {
  id: "debit-1",
  date: "2026-07-01",
  amount: 5000,
  type: "card_debit",
  fromAccountId: "settlement-1",
  toAccountId: null,
  cardId: "card-1",
  memo: "引き落とし",
  recurringRuleId: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deletedAt: null,
};

describe("card debit edit", () => {
  it("既存値から編集状態を作る", () => {
    expect(createCardDebitEditState(debit)).toEqual({
      amountText: "5000",
      date: "2026-07-01",
      memo: "引き落とし",
    });
  });

  it("type/from/cardIdを変更しない限定パッチを作る", () => {
    expect(
      buildCardDebitEditPatch(
        debit,
        { amountText: "4800", date: "2026-7-3", memo: "確定額" },
        "2026-07-18"
      )
    ).toEqual({ amount: 4800, date: "2026-07-03", memo: "確定額" });
  });

  it("0・小数・未来日を拒否する", () => {
    expect(() =>
      buildCardDebitEditPatch(debit, { amountText: "0", date: debit.date, memo: "" }, "2026-07-18")
    ).toThrow("金額は正の整数で入力してください");
    expect(() =>
      buildCardDebitEditPatch(debit, { amountText: "1.5", date: debit.date, memo: "" }, "2026-07-18")
    ).toThrow("金額は正の整数で入力してください");
    expect(() =>
      buildCardDebitEditPatch(debit, { amountText: "1", date: "2026-07-19", memo: "" }, "2026-07-18")
    ).toThrow("未来の日付は記録できません");
  });

  it("存在しない日付と別typeを拒否する", () => {
    expect(() =>
      buildCardDebitEditPatch(debit, { amountText: "1", date: "2026-02-30", memo: "" }, "2026-07-18")
    ).toThrow("invalid date value");
    expect(() => createCardDebitEditState({ ...debit, type: "income" })).toThrow(
      "カード引き落とし以外はこの画面で訂正できません"
    );
  });

  it("定期引き落としは別の月へ移動できない", () => {
    const recurring = { ...debit, recurringRuleId: "rule-debit" };
    expect(() =>
      buildCardDebitEditPatch(
        recurring,
        { amountText: "5000", date: "2026-06-30", memo: "" },
        "2026-07-18"
      )
    ).toThrow("定期取引は別の月へ移動できません");
  });
});
