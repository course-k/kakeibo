import { deriveBalance } from "../../domain/balance";
import { deriveCardStatement } from "../../domain/card-statement";
import { deriveSavings } from "../../domain/savings";
import type { Account, Card, Transaction } from "../../domain/types";

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

export type HomeViewModel = {
  budgetAccounts: HomeBudgetAccountItem[];
  cards: HomeCardItem[];
  savingsAmount: number;
};

export function buildHomeViewModel(
  accounts: Account[],
  cards: Card[],
  transactions: Transaction[],
  today: string
): HomeViewModel {
  const activeBudgetAccounts = accounts.filter(
    (account) => account.type === "budget" && account.archivedAt === null
  );
  const budgetAccounts = activeBudgetAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    remainingAmount: deriveBalance(account.id, transactions),
  }));

  return {
    budgetAccounts,
    cards: cards.map((card) => {
      const statement = deriveCardStatement(card, transactions, today);
      return {
        id: card.id,
        name: card.name,
        debitDay: card.debitDay,
        preparedAmount: statement.currentAmount,
        needsAttention: statement.currentAmount < 0,
      };
    }),
    savingsAmount: deriveSavings(activeBudgetAccounts, transactions),
  };
}
