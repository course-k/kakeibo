import type { NewRecurringRuleInput } from "../../db/recurring-rules-repository";
import type { NewTransactionInput, TransactionPatch } from "../../db/transactions-repository";
import type { Card, Transaction } from "../../domain/types";

export type EntryKind = "expense" | "income" | "transfer";
export type EntryPayment = { kind: "cash" } | { kind: "card"; cardId: string };

export type EntryFormState = {
  kind: EntryKind;
  amountText: string;
  date: string;
  memo: string;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  payment: EntryPayment;
  recurring: boolean;
  dayOfMonth: string;
};

export function entryKindFromTransaction(transaction: Transaction): EntryKind | null {
  if (transaction.type === "income") return "income";
  if (transaction.type === "expense_cash" || transaction.type === "expense_card") return "expense";
  if (transaction.type === "transfer") return "transfer";
  return null;
}

export function createEntryState(kind: EntryKind, date: string): EntryFormState {
  return {
    kind,
    amountText: "",
    date,
    memo: "",
    categoryId: null,
    fromAccountId: null,
    toAccountId: null,
    payment: { kind: "cash" },
    recurring: false,
    dayOfMonth: String(Number(date.slice(8, 10)) || 1),
  };
}

export function changeEntryKind(state: EntryFormState, kind: EntryKind): EntryFormState {
  return {
    ...state,
    kind,
    categoryId: null,
    fromAccountId: null,
    toAccountId: null,
    payment: { kind: "cash" },
  };
}

export function entryStateFromTransaction(transaction: Transaction): EntryFormState {
  const kind = entryKindFromTransaction(transaction);
  if (!kind) throw new Error("この記録は入力画面では編集できません");
  return {
    kind,
    amountText: String(transaction.amount),
    date: transaction.date,
    memo: transaction.memo,
    categoryId: transaction.categoryId ?? null,
    fromAccountId: transaction.fromAccountId,
    toAccountId: transaction.toAccountId,
    payment:
      transaction.type === "expense_card" && transaction.cardId
        ? { kind: "card", cardId: transaction.cardId }
        : { kind: "cash" },
    recurring: false,
    dayOfMonth: String(Number(transaction.date.slice(8, 10))),
  };
}

export function entryStateFromRecurringRule(
  rule: NewRecurringRuleInput,
  today: string,
): EntryFormState {
  const kind = entryKindFromTransaction({ type: rule.type } as Transaction);
  if (!kind) throw new Error("この定期記録は入力画面では編集できません");
  return {
    kind,
    amountText: String(rule.amount),
    date: today,
    memo: rule.memo,
    categoryId: rule.categoryId ?? null,
    fromAccountId: rule.fromAccountId,
    toAccountId: rule.toAccountId,
    payment:
      rule.type === "expense_card" && rule.cardId
        ? { kind: "card", cardId: rule.cardId }
        : { kind: "cash" },
    recurring: true,
    dayOfMonth: String(rule.dayOfMonth),
  };
}

function positiveAmount(amountText: string): number {
  const normalized = amountText.replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) throw new Error("金額は正の整数で入力してください");
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("金額は正の整数で入力してください");
  }
  return amount;
}

export function buildEntryTransactionInput(
  state: EntryFormState,
  cards: Card[],
): NewTransactionInput {
  const amount = positiveAmount(state.amountText);
  if (state.kind === "income") {
    if (!state.toAccountId) throw new Error("入金先の予算を選択してください");
    if (!state.categoryId) throw new Error("収入カテゴリを選択してください");
    return {
      date: state.date,
      amount,
      type: "income",
      fromAccountId: null,
      toAccountId: state.toAccountId,
      cardId: null,
      categoryId: state.categoryId,
      memo: state.memo.trim(),
      recurringRuleId: null,
    };
  }
  if (state.kind === "transfer") {
    if (!state.fromAccountId || !state.toAccountId) throw new Error("移動元と移動先を選択してください");
    if (state.fromAccountId === state.toAccountId) throw new Error("異なる予算を選択してください");
    return {
      date: state.date,
      amount,
      type: "transfer",
      fromAccountId: state.fromAccountId,
      toAccountId: state.toAccountId,
      cardId: null,
      categoryId: null,
      memo: state.memo.trim() || "予算を移動",
      recurringRuleId: null,
    };
  }
  if (!state.fromAccountId) throw new Error("支出元の予算を選択してください");
  if (!state.categoryId) throw new Error("支出カテゴリを選択してください");
  if (state.payment.kind === "cash") {
    return {
      date: state.date,
      amount,
      type: "expense_cash",
      fromAccountId: state.fromAccountId,
      toAccountId: null,
      cardId: null,
      categoryId: state.categoryId,
      memo: state.memo.trim(),
      recurringRuleId: null,
    };
  }
  const cardId = state.payment.cardId;
  const card = cards.find((item) => item.id === cardId);
  if (!card) throw new Error("カードを選択してください");
  return {
    date: state.date,
    amount,
    type: "expense_card",
    fromAccountId: state.fromAccountId,
    toAccountId: card.settlementAccountId,
    cardId: card.id,
    categoryId: state.categoryId,
    memo: state.memo.trim(),
    recurringRuleId: null,
  };
}

export function buildEntryTransactionPatch(
  state: EntryFormState,
  cards: Card[],
  original: Transaction,
): TransactionPatch {
  if (original.type === "transfer") throw new Error("振替は削除して記録し直してください");
  return {
    ...buildEntryTransactionInput(state, cards),
    recurringRuleId: original.recurringRuleId,
  };
}

export function buildEntryRecurringRuleInput(
  state: EntryFormState,
  cards: Card[],
): NewRecurringRuleInput {
  const transaction = buildEntryTransactionInput(state, cards);
  const dayOfMonth = Number(state.dayOfMonth);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new Error("毎月の日付は1〜31で入力してください");
  }
  return {
    ruleKind: "user",
    type: transaction.type,
    amount: transaction.amount,
    fromAccountId: transaction.fromAccountId,
    toAccountId: transaction.toAccountId,
    cardId: transaction.cardId,
    categoryId: transaction.categoryId ?? null,
    memo: transaction.memo,
    dayOfMonth,
  };
}
