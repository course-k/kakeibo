// 取引の妥当性検証。type ごとの from/to 制約（spec §2.1）と金額制約（不変条件 1・2）を検証する。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 取引タイプと口座の動き / §2.3 不変条件 1・2
import { isValidAmount } from "./amount";
import type { Account, AccountType, Transaction, TransactionType } from "./types";

export type ValidationErrorReason =
  | "invalid_amount"
  | "missing_from_account"
  | "missing_to_account"
  | "unexpected_from_account"
  | "unexpected_to_account"
  | "from_account_not_found"
  | "to_account_not_found"
  | "invalid_from_account_type"
  | "invalid_to_account_type"
  | "invalid_adjustment_accounts";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: ValidationErrorReason };

type Ctx = Pick<Transaction, "fromAccountId" | "toAccountId">;

function findAccount(accounts: Account[], id: string | null): Account | undefined {
  if (id === null) return undefined;
  return accounts.find((a) => a.id === id);
}

/** from 側が指定の口座種別を満たすことを検証する。 */
function checkFrom(tx: Ctx, accounts: Account[], expectedType: AccountType): ValidationResult {
  if (tx.fromAccountId === null) return { ok: false, reason: "missing_from_account" };
  const account = findAccount(accounts, tx.fromAccountId);
  if (!account) return { ok: false, reason: "from_account_not_found" };
  if (account.type !== expectedType) return { ok: false, reason: "invalid_from_account_type" };
  return { ok: true };
}

/** to 側が指定の口座種別を満たすことを検証する。 */
function checkTo(tx: Ctx, accounts: Account[], expectedType: AccountType): ValidationResult {
  if (tx.toAccountId === null) return { ok: false, reason: "missing_to_account" };
  const account = findAccount(accounts, tx.toAccountId);
  if (!account) return { ok: false, reason: "to_account_not_found" };
  if (account.type !== expectedType) return { ok: false, reason: "invalid_to_account_type" };
  return { ok: true };
}

function checkNoFrom(tx: Ctx): ValidationResult {
  if (tx.fromAccountId !== null) return { ok: false, reason: "unexpected_from_account" };
  return { ok: true };
}

function checkNoTo(tx: Ctx): ValidationResult {
  if (tx.toAccountId !== null) return { ok: false, reason: "unexpected_to_account" };
  return { ok: true };
}

function validateByType(
  type: TransactionType,
  tx: Ctx,
  accounts: Account[]
): ValidationResult {
  switch (type) {
    case "income": {
      // from: 外部（null）/ to: budget
      const noFrom = checkNoFrom(tx);
      if (!noFrom.ok) return noFrom;
      return checkTo(tx, accounts, "budget");
    }
    case "expense_cash": {
      // from: budget / to: 外部（null）
      const from = checkFrom(tx, accounts, "budget");
      if (!from.ok) return from;
      return checkNoTo(tx);
    }
    case "expense_card": {
      // from: budget / to: card_settlement
      const from = checkFrom(tx, accounts, "budget");
      if (!from.ok) return from;
      return checkTo(tx, accounts, "card_settlement");
    }
    case "transfer": {
      // from: budget / to: budget
      const from = checkFrom(tx, accounts, "budget");
      if (!from.ok) return from;
      return checkTo(tx, accounts, "budget");
    }
    case "card_debit": {
      // from: card_settlement / to: 外部（null）
      const from = checkFrom(tx, accounts, "card_settlement");
      if (!from.ok) return from;
      return checkNoTo(tx);
    }
    case "adjustment": {
      // どちらか片側のみ（both も neither も不可）。口座種別は問わない。
      const hasFrom = tx.fromAccountId !== null;
      const hasTo = tx.toAccountId !== null;
      if (hasFrom === hasTo) return { ok: false, reason: "invalid_adjustment_accounts" };
      if (hasFrom && !findAccount(accounts, tx.fromAccountId)) {
        return { ok: false, reason: "from_account_not_found" };
      }
      if (hasTo && !findAccount(accounts, tx.toAccountId)) {
        return { ok: false, reason: "to_account_not_found" };
      }
      return { ok: true };
    }
  }
}

/**
 * 取引を検証する。金額（不変条件 1）と type ごとの from/to 制約（不変条件 2）を満たさない場合、
 * ok: false と理由を返す。
 */
export function validateTransaction(
  tx: Pick<Transaction, "amount" | "type" | "fromAccountId" | "toAccountId">,
  accounts: Account[]
): ValidationResult {
  if (!isValidAmount(tx.amount)) return { ok: false, reason: "invalid_amount" };
  return validateByType(tx.type, tx, accounts);
}
