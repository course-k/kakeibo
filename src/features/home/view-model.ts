import { deriveBalance } from "../../domain/balance";
import { deriveCardPreparedAmount } from "../../domain/card-statement";
import { deriveSavings } from "../../domain/savings";
import type { Account, Card, Category, Transaction, TransactionType } from "../../domain/types";

export type HomeBudgetAccountItem = {
  id: string;
  name: string;
  remainingAmount: number;
};

export type HomeCardItem = {
  id: string;
  name: string;
  debitDay: number;
  preparedAmount: number;
  needsAttention: boolean;
};

export type TransactionHistoryItem = {
  id: string;
  date: string;
  type: TransactionType;
  typeLabel: string;
  accountLabel: string;
  categoryLabel: string | null;
  amount: number;
  amountDirection: "in" | "out" | "neutral";
  memo: string;
  editable: boolean;
};

export type HomeViewModel = {
  budgetAccounts: HomeBudgetAccountItem[];
  cards: HomeCardItem[];
  savingsAmount: number;
  recentTransactions: TransactionHistoryItem[];
};

export function buildHomeViewModel(
  accounts: Account[],
  cards: Card[],
  transactions: Transaction[],
  today: string,
  categories: Category[] = [],
): HomeViewModel {
  const activeBudgetAccounts = accounts.filter(
    (account) => account.type === "budget" && account.archivedAt === null
  );
  const budgetAccounts = activeBudgetAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    remainingAmount: deriveBalance(account.id, transactions, today),
  }));

  return {
    budgetAccounts,
    cards: cards.map((card) => {
      const preparedAmount = deriveCardPreparedAmount(card, transactions, today);
      return {
        id: card.id,
        name: card.name,
        debitDay: card.debitDay,
        preparedAmount,
        needsAttention: preparedAmount < 0,
      };
    }),
    savingsAmount: deriveSavings(activeBudgetAccounts, transactions, today),
    recentTransactions: buildTransactionHistoryItems(accounts, cards, transactions, categories).slice(0, 5),
  };
}

export function buildTransactionHistoryItems(
  accounts: Account[],
  cards: Card[],
  transactions: Transaction[],
  categories: Category[] = [],
): TransactionHistoryItem[] {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const cardNames = new Map(cards.map((card) => [card.id, card.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  return [...transactions]
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
    )
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      type: transaction.type,
      typeLabel: transactionTypeLabel(transaction.type),
      accountLabel: buildAccountLabel(transaction, accountNames, cardNames),
      categoryLabel: transaction.categoryId ? (categoryNames.get(transaction.categoryId) ?? "不明なカテゴリ") : null,
      amount: transaction.amount,
      amountDirection: amountDirection(transaction),
      memo: transaction.memo,
      editable: true,
    }));
}

function transactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case "income":
      return "予算を追加";
    case "expense_cash":
      return "現金・即時払い";
    case "expense_card":
      return "カード利用";
    case "transfer":
      return "予算を移す";
    case "card_debit":
      return "カード引き落とし";
    case "adjustment":
      return "残高を合わせる";
  }
}

function buildAccountLabel(
  transaction: Transaction,
  accountNames: Map<string, string>,
  cardNames: Map<string, string>
): string {
  const fromName = resolveName(transaction.fromAccountId, accountNames);
  const toName = resolveName(transaction.toAccountId, accountNames);
  const cardName = resolveName(transaction.cardId, cardNames);

  switch (transaction.type) {
    case "income":
      return toName;
    case "expense_cash":
      return fromName;
    case "expense_card":
      return cardName === "不明" ? fromName : `${fromName} / ${cardName}`;
    case "transfer":
      return `${fromName} → ${toName}`;
    case "card_debit":
      return cardName === "不明" ? fromName : cardName;
    case "adjustment":
      return transaction.toAccountId ? toName : fromName;
  }
}

function resolveName(id: string | null, names: Map<string, string>): string {
  return id ? (names.get(id) ?? "不明") : "不明";
}

function amountDirection(transaction: Transaction): TransactionHistoryItem["amountDirection"] {
  switch (transaction.type) {
    case "income":
      return "in";
    case "expense_cash":
    case "expense_card":
    case "card_debit":
      return "out";
    case "transfer":
      return "neutral";
    case "adjustment":
      return transaction.toAccountId ? "in" : "out";
  }
}
