import type { Account, Transaction, YearMonth } from "../../domain/types";

export type AccountMonthlyExpense = {
  accountId: string;
  accountName: string;
  month: YearMonth;
  amount: number;
};

type AccountMonthlyExpenseAccumulator = AccountMonthlyExpense & {
  accountSortOrder: number;
};

export type MonthlyTrend = {
  month: YearMonth;
  amount: number;
};

export type ReportSummary = {
  byAccount: AccountMonthlyExpense[];
  monthlyTrend: MonthlyTrend[];
};

function toYearMonth(date: string): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

function isReportExpense(tx: Transaction): boolean {
  return tx.deletedAt === null && (tx.type === "expense_cash" || tx.type === "expense_card");
}

export function summarizeMonthlyBudgetExpenses(
  accounts: Account[],
  transactions: Transaction[]
): ReportSummary {
  const budgetAccounts = accounts.filter((account) => account.type === "budget");
  const accountById = new Map(budgetAccounts.map((account) => [account.id, account]));
  const byAccountMap = new Map<string, AccountMonthlyExpenseAccumulator>();
  const trendMap = new Map<YearMonth, number>();

  for (const tx of transactions) {
    if (!isReportExpense(tx) || tx.fromAccountId === null) continue;
    const account = accountById.get(tx.fromAccountId);
    if (!account) continue;

    const month = toYearMonth(tx.date);
    const key = `${month}:${account.id}`;
    const current = byAccountMap.get(key) ?? {
      accountId: account.id,
      accountName: account.name,
      accountSortOrder: account.sortOrder,
      month,
      amount: 0,
    };
    current.amount += tx.amount;
    byAccountMap.set(key, current);
    trendMap.set(month, (trendMap.get(month) ?? 0) + tx.amount);
  }

  return {
    byAccount: Array.from(byAccountMap.values())
      .sort(
        (a, b) =>
          a.month.localeCompare(b.month) ||
          a.accountSortOrder - b.accountSortOrder ||
          a.accountId.localeCompare(b.accountId)
      )
      .map(({ accountSortOrder: _accountSortOrder, ...expense }) => expense),
    monthlyTrend: Array.from(trendMap.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
