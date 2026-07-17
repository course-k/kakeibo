// 取引の妥当性検証。type ごとの from/to 制約（spec §2.1）と金額制約（不変条件 1・2）を検証する。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 取引タイプと口座の動き / §2.3 不変条件 1・2
import { isValidAmount } from "./amount";
import type { Account, AccountType, Card, Transaction, TransactionType } from "./types";

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
  | "invalid_adjustment_accounts"
  | "same_transfer_account"
  | "missing_card"
  | "unexpected_card"
  | "card_not_found"
  | "card_settlement_mismatch";

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

/**
 * expense_card/card_debit の cardId が実在する Card を指し、かつその Card の
 * settlementAccountId が取引の決済口座側（settlementAccountId）と一致することを検証する。
 * cardId が未設定（null/undefined）の場合はカード紐付けなしとして検証をスキップする。
 */
function checkCardLink(
  cardId: string | null | undefined,
  settlementAccountId: string | null,
  cards: Card[]
): ValidationResult {
  if (cardId === null || cardId === undefined) return { ok: true };
  const card = cards.find((c) => c.id === cardId);
  if (!card) return { ok: false, reason: "card_not_found" };
  if (card.settlementAccountId !== settlementAccountId) {
    return { ok: false, reason: "card_settlement_mismatch" };
  }
  return { ok: true };
}

function validateByType(
  type: TransactionType,
  tx: Ctx & { cardId?: Transaction["cardId"] },
  accounts: Account[],
  cards: Card[]
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
      const to = checkTo(tx, accounts, "card_settlement");
      if (!to.ok) return to;
      if (!tx.cardId) return { ok: false, reason: "missing_card" };
      return checkCardLink(tx.cardId, tx.toAccountId, cards);
    }
    case "transfer": {
      // from: budget / to: budget
      const from = checkFrom(tx, accounts, "budget");
      if (!from.ok) return from;
      const to = checkTo(tx, accounts, "budget");
      if (!to.ok) return to;
      if (tx.fromAccountId === tx.toAccountId) return { ok: false, reason: "same_transfer_account" };
      return { ok: true };
    }
    case "card_debit": {
      // from: card_settlement / to: 外部（null）
      const from = checkFrom(tx, accounts, "card_settlement");
      if (!from.ok) return from;
      const noTo = checkNoTo(tx);
      if (!noTo.ok) return noTo;
      if (!tx.cardId) return { ok: false, reason: "missing_card" };
      return checkCardLink(tx.cardId, tx.fromAccountId, cards);
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
      if (tx.cardId != null) {
        const adjustedAccountId = hasFrom ? tx.fromAccountId : tx.toAccountId;
        const adjustedAccount = findAccount(accounts, adjustedAccountId);
        if (adjustedAccount?.type !== "card_settlement") {
          return { ok: false, reason: "card_settlement_mismatch" };
        }
        return checkCardLink(tx.cardId, adjustedAccountId, cards);
      }
      return { ok: true };
    }
  }
}

/**
 * 取引を検証する。金額（不変条件 1）と type ごとの from/to 制約（不変条件 2）に加え、
 * expense_card/card_debit の cardId が実在するカードの決済口座と一致することを検証する。
 * ok: false の場合は理由を返す。
 */
export function validateTransaction(
  tx: Pick<Transaction, "amount" | "type" | "fromAccountId" | "toAccountId"> & {
    cardId?: Transaction["cardId"];
  },
  accounts: Account[],
  cards: Card[]
): ValidationResult {
  if (!isValidAmount(tx.amount)) return { ok: false, reason: "invalid_amount" };
  if (
    tx.type !== "expense_card" &&
    tx.type !== "card_debit" &&
    tx.type !== "adjustment" &&
    tx.cardId != null
  ) {
    return { ok: false, reason: "unexpected_card" };
  }
  return validateByType(tx.type, tx, accounts, cards);
}
