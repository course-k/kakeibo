import type { NewTransactionInput, TransactionPatch } from "@/db/transactions-repository";
import type { Account, Card, Transaction } from "@/domain/types";

export type PaymentSelection =
  | { kind: "cash" }
  | { kind: "card"; cardId: string };

export type InputFormState = {
  amountText: string;
  budgetAccountId: string | null;
  payment: PaymentSelection;
  date: string;
  memo: string;
};

export type InputDefaults = {
  budgetAccountId: string | null;
  payment: PaymentSelection;
};

export function selectInputBudgetAccounts(
  accounts: Account[],
  editingBudgetAccountId: string | null
): Account[] {
  return accounts.filter(
    (account) =>
      account.type === "budget" &&
      (account.archivedAt === null || account.id === editingBudgetAccountId)
  );
}

export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createInitialInputState(
  defaults: InputDefaults,
  today: string
): InputFormState {
  return {
    amountText: "",
    budgetAccountId: defaults.budgetAccountId,
    payment: defaults.payment,
    date: today,
    memo: "",
  };
}

export function appendAmountDigit(current: string, digit: string): string {
  if (!/^\d$/.test(digit)) return current;
  if (current === "0") return digit;
  return `${current}${digit}`;
}

export function deleteAmountDigit(current: string): string {
  return current.slice(0, -1);
}

export function clearAmount(): string {
  return "";
}

export function amountFromText(amountText: string): number | null {
  if (!/^[1-9]\d*$/.test(amountText)) return null;
  const amount = Number(amountText);
  if (!Number.isSafeInteger(amount)) return null;
  return amount;
}

export function buildExpenseTransactionInput(
  state: InputFormState,
  cards: Card[]
): NewTransactionInput {
  const amount = amountFromText(state.amountText);
  if (amount === null) {
    throw new Error("金額は正の整数で入力してください");
  }
  if (!state.budgetAccountId) {
    throw new Error("予算口座を選択してください");
  }

  if (state.payment.kind === "cash") {
    return {
      date: state.date,
      amount,
      type: "expense_cash",
      fromAccountId: state.budgetAccountId,
      toAccountId: null,
      cardId: null,
      memo: state.memo,
      recurringRuleId: null,
    };
  }

  const payment = state.payment;
  const card = cards.find((item) => item.id === payment.cardId);
  if (!card) {
    throw new Error("カードを選択してください");
  }

  return {
    date: state.date,
    amount,
    type: "expense_card",
    fromAccountId: state.budgetAccountId,
    toAccountId: card.settlementAccountId,
    cardId: card.id,
    memo: state.memo,
    recurringRuleId: null,
  };
}

export function buildExpenseTransactionPatch(
  state: InputFormState,
  cards: Card[]
): TransactionPatch {
  return buildExpenseTransactionInput(state, cards);
}

export function deriveLastInputDefaults(
  transactions: Transaction[],
  cards: Card[]
): InputDefaults {
  const latest = [...transactions]
    .filter((tx) => tx.type === "expense_cash" || tx.type === "expense_card")
    .sort((a, b) => {
      const createdOrder = a.createdAt.localeCompare(b.createdAt);
      return createdOrder;
    })
    .at(-1);

  if (!latest) {
    return { budgetAccountId: null, payment: { kind: "cash" } };
  }

  if (latest.type === "expense_card" && latest.cardId && cards.some((card) => card.id === latest.cardId)) {
    return {
      budgetAccountId: latest.fromAccountId,
      payment: { kind: "card", cardId: latest.cardId },
    };
  }

  return {
    budgetAccountId: latest.fromAccountId,
    payment: { kind: "cash" },
  };
}

export function inputStateFromTransaction(
  transaction: Transaction,
  cards: Card[]
): InputFormState {
  return {
    amountText: String(transaction.amount),
    budgetAccountId: transaction.fromAccountId,
    payment:
      transaction.type === "expense_card" &&
      transaction.cardId &&
      cards.some((card) => card.id === transaction.cardId)
        ? { kind: "card", cardId: transaction.cardId }
        : { kind: "cash" },
    date: transaction.date,
    memo: transaction.memo,
  };
}

export function createEditingInputState(
  transaction: Transaction,
  cards: Card[],
  accounts: Account[]
): InputFormState {
  const state = inputStateFromTransaction(transaction, cards);
  const sourceExists = selectInputBudgetAccounts(
    accounts,
    transaction.fromAccountId
  ).some((account) => account.id === transaction.fromAccountId);
  if (!sourceExists) {
    throw new Error("この支出に紐づく予算が見つかりません");
  }
  return state;
}
