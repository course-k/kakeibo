import { describe, expect, it } from "vitest";
import { validateTransaction } from "./validate-transaction";
import { makeAccount } from "./test-fixtures";
import type { Account } from "./types";

describe("validateTransaction", () => {
  const budget = makeAccount({ id: "budget-1", type: "budget" });
  const budget2 = makeAccount({ id: "budget-2", type: "budget" });
  const settlement = makeAccount({ id: "settlement-1", type: "card_settlement" });
  const accounts: Account[] = [budget, budget2, settlement];

  describe("金額制約（不変条件 1）", () => {
    it("0 円は不正", () => {
      const result = validateTransaction(
        { amount: 0, type: "income", fromAccountId: null, toAccountId: budget.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_amount" });
    });

    it("負の金額は不正", () => {
      const result = validateTransaction(
        { amount: -100, type: "income", fromAccountId: null, toAccountId: budget.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_amount" });
    });

    it("小数は不正", () => {
      const result = validateTransaction(
        { amount: 100.5, type: "income", fromAccountId: null, toAccountId: budget.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_amount" });
    });
  });

  describe("income（外部 -> budget）", () => {
    it("正常系: budget への収入", () => {
      const result = validateTransaction(
        { amount: 1000, type: "income", fromAccountId: null, toAccountId: budget.id },
        accounts
      );
      expect(result).toEqual({ ok: true });
    });

    it("違反: from が設定されている", () => {
      const result = validateTransaction(
        { amount: 1000, type: "income", fromAccountId: budget.id, toAccountId: budget2.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "unexpected_from_account" });
    });

    it("違反: to が未設定", () => {
      const result = validateTransaction(
        { amount: 1000, type: "income", fromAccountId: null, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "missing_to_account" });
    });

    it("違反: to が card_settlement 口座", () => {
      const result = validateTransaction(
        { amount: 1000, type: "income", fromAccountId: null, toAccountId: settlement.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_to_account_type" });
    });
  });

  describe("expense_cash（budget -> 外部）", () => {
    it("正常系: budget からの支出", () => {
      const result = validateTransaction(
        { amount: 500, type: "expense_cash", fromAccountId: budget.id, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: true });
    });

    it("違反: from が未設定", () => {
      const result = validateTransaction(
        { amount: 500, type: "expense_cash", fromAccountId: null, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "missing_from_account" });
    });

    it("違反: to が設定されている", () => {
      const result = validateTransaction(
        { amount: 500, type: "expense_cash", fromAccountId: budget.id, toAccountId: budget2.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "unexpected_to_account" });
    });

    it("違反: from が card_settlement 口座", () => {
      const result = validateTransaction(
        { amount: 500, type: "expense_cash", fromAccountId: settlement.id, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_from_account_type" });
    });
  });

  describe("expense_card（budget -> card_settlement）", () => {
    it("正常系: カード支出", () => {
      const result = validateTransaction(
        { amount: 3000, type: "expense_card", fromAccountId: budget.id, toAccountId: settlement.id },
        accounts
      );
      expect(result).toEqual({ ok: true });
    });

    it("違反: to が budget 口座", () => {
      const result = validateTransaction(
        { amount: 3000, type: "expense_card", fromAccountId: budget.id, toAccountId: budget2.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_to_account_type" });
    });

    it("違反: from が未設定", () => {
      const result = validateTransaction(
        { amount: 3000, type: "expense_card", fromAccountId: null, toAccountId: settlement.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "missing_from_account" });
    });
  });

  describe("transfer（budget -> budget）", () => {
    it("正常系: 予算間振替", () => {
      const result = validateTransaction(
        { amount: 2000, type: "transfer", fromAccountId: budget.id, toAccountId: budget2.id },
        accounts
      );
      expect(result).toEqual({ ok: true });
    });

    it("違反: to が card_settlement 口座", () => {
      const result = validateTransaction(
        { amount: 2000, type: "transfer", fromAccountId: budget.id, toAccountId: settlement.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_to_account_type" });
    });

    it("違反: from が未設定", () => {
      const result = validateTransaction(
        { amount: 2000, type: "transfer", fromAccountId: null, toAccountId: budget2.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "missing_from_account" });
    });
  });

  describe("card_debit（card_settlement -> 外部）", () => {
    it("正常系: 消し込み", () => {
      const result = validateTransaction(
        { amount: 3000, type: "card_debit", fromAccountId: settlement.id, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: true });
    });

    it("違反: from が budget 口座", () => {
      const result = validateTransaction(
        { amount: 3000, type: "card_debit", fromAccountId: budget.id, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_from_account_type" });
    });

    it("違反: to が設定されている", () => {
      const result = validateTransaction(
        { amount: 3000, type: "card_debit", fromAccountId: settlement.id, toAccountId: budget.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "unexpected_to_account" });
    });
  });

  describe("adjustment（片側のみ）", () => {
    it("正常系: from のみ（残高減の調整）", () => {
      const result = validateTransaction(
        { amount: 100, type: "adjustment", fromAccountId: budget.id, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: true });
    });

    it("正常系: to のみ（残高増の調整）", () => {
      const result = validateTransaction(
        { amount: 100, type: "adjustment", fromAccountId: null, toAccountId: settlement.id },
        accounts
      );
      expect(result).toEqual({ ok: true });
    });

    it("違反: 両方設定されている", () => {
      const result = validateTransaction(
        { amount: 100, type: "adjustment", fromAccountId: budget.id, toAccountId: budget2.id },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_adjustment_accounts" });
    });

    it("違反: どちらも未設定", () => {
      const result = validateTransaction(
        { amount: 100, type: "adjustment", fromAccountId: null, toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "invalid_adjustment_accounts" });
    });

    it("違反: 存在しない口座 id", () => {
      const result = validateTransaction(
        { amount: 100, type: "adjustment", fromAccountId: "nonexistent", toAccountId: null },
        accounts
      );
      expect(result).toEqual({ ok: false, reason: "from_account_not_found" });
    });
  });
});
