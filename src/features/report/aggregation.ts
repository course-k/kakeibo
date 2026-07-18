import type { Account, Category, Transaction, YearMonth } from "../../domain/types";

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

export type CategoryMonthlyExpense = {
  categoryId: string;
  categoryName: string;
  month: YearMonth;
  amount: number;
};

type CategoryMonthlyExpenseAccumulator = CategoryMonthlyExpense & {
  categorySortOrder: number;
};

export type ReportSummary = {
  byAccount: AccountMonthlyExpense[];
  byCategory: CategoryMonthlyExpense[];
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
  transactions: Transaction[],
  categories: Category[] = [],
): ReportSummary {
  const budgetAccounts = accounts.filter((account) => account.type === "budget");
  const accountById = new Map(budgetAccounts.map((account) => [account.id, account]));
  const byAccountMap = new Map<string, AccountMonthlyExpenseAccumulator>();
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const byCategoryMap = new Map<string, CategoryMonthlyExpenseAccumulator>();
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

    const category = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
    const categoryId = category?.id ?? "uncategorized";
    const categoryKey = `${month}:${categoryId}`;
    const categoryCurrent = byCategoryMap.get(categoryKey) ?? {
      categoryId,
      categoryName: category?.name ?? "未分類",
      categorySortOrder: category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      month,
      amount: 0,
    };
    categoryCurrent.amount += tx.amount;
    byCategoryMap.set(categoryKey, categoryCurrent);
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
    byCategory: Array.from(byCategoryMap.values())
      .sort(
        (a, b) =>
          a.month.localeCompare(b.month) ||
          a.categorySortOrder - b.categorySortOrder ||
          a.categoryId.localeCompare(b.categoryId)
      )
      .map(({ categorySortOrder: _categorySortOrder, ...expense }) => expense),
    monthlyTrend: Array.from(trendMap.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
