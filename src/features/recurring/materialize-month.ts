import { listRecurringRules } from "../../db/recurring-rules-repository";
import { listAccounts } from "../../db/accounts-repository";
import type { AppDatabase } from "../../db/client";
import {
  insertTransactionsAtomically,
  listTransactions,
} from "../../db/transactions-repository";
import type { NewTransactionInput } from "../../db/transactions-repository";
import { expandRecurring } from "../../domain/recurring";
import type { Account, RecurringRule, Transaction, YearMonth } from "../../domain/types";

export type RecurringMaterializationResult = {
  created: Transaction[];
  skipped: number;
};

const inFlightByDatabase = new WeakMap<
  AppDatabase,
  Map<string, Promise<RecurringMaterializationResult>>
>();

function assertYearMonth(value: string): asserts value is YearMonth {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) {
    throw new Error(`invalid year-month: ${value}`);
  }
}

function localYearMonth(now: Date): YearMonth {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function localIsoDate(now: Date): string {
  const yearMonth = localYearMonth(now);
  const day = String(now.getDate()).padStart(2, "0");
  return `${yearMonth}-${day}`;
}

/**
 * 復旧前は account.monthlyBudget と月初 income rule を別々に保存できたため、
 * 旧 DB/backup では両者が一致するとは限らない。不一致を自動修復すると、どちらを
 * 正とするかをアプリが勝手に決めることになるため、実取引を1件も書く前に拒否する。
 */
function assertMonthlyBudgetRuleConsistency(
  activeAccounts: Account[],
  rules: RecurringRule[],
): void {
  for (const account of activeAccounts) {
    if (account.type !== "budget") continue;

    const monthlyRules = rules.filter(
      (rule) =>
        rule.type === "income" &&
        rule.fromAccountId === null &&
        rule.toAccountId === account.id &&
        rule.cardId === null &&
        rule.dayOfMonth === 1,
    );
    const amounts = monthlyRules.map((rule) => rule.amount);
    const consistent =
      account.monthlyBudget === 0
        ? monthlyRules.length === 0
        : account.monthlyBudget > 0 &&
          monthlyRules.length === 1 &&
          monthlyRules[0].amount === account.monthlyBudget;

    if (!consistent) {
      throw new Error(
        `毎月の予算設定が一致していません。「${account.name}」を設定で編集し、` +
          `金額を確認して保存してください（予算: ${account.monthlyBudget}円、` +
          `自動充当: ${amounts.length === 0 ? "未設定" : `${amounts.join("円・")}円`}）。`,
      );
    }
  }
}

/**
 * 全定期ルールを対象月の実取引へ変換する。
 *
 * 同じ recurringRuleId の取引が対象月に一度でも生成済みならスキップする。
 * 論理削除済みも生成済みとして扱い、ユーザーが削除した定期取引を再生成しない。
 */
async function materialize(
  db: AppDatabase,
  targetMonth: YearMonth,
  throughDate?: string,
): Promise<RecurringMaterializationResult> {
  const [rules, transactions, activeAccounts] = await Promise.all([
    listRecurringRules(db),
    listTransactions(db, { includeDeleted: true }),
    listAccounts(db),
  ]);
  const activeAccountIds = new Set(activeAccounts.map((account) => account.id));
  assertMonthlyBudgetRuleConsistency(activeAccounts, rules);
  const materializedRuleIds = new Set(
    transactions
      .filter(
        (transaction) =>
          transaction.recurringRuleId !== null &&
          transaction.date.slice(0, 7) === targetMonth,
      )
      .map((transaction) => transaction.recurringRuleId as string),
  );

  const inputs: NewTransactionInput[] = [];
  let skipped = 0;
  for (const rule of rules) {
    const referencesInactiveAccount =
      (rule.fromAccountId !== null && !activeAccountIds.has(rule.fromAccountId)) ||
      (rule.toAccountId !== null && !activeAccountIds.has(rule.toAccountId));
    if (referencesInactiveAccount) {
      skipped += 1;
      continue;
    }
    if (materializedRuleIds.has(rule.id)) {
      skipped += 1;
      continue;
    }

    const [draft] = expandRecurring(rule, {
      from: targetMonth,
      to: targetMonth,
    });
    if (throughDate !== undefined && draft.date > throughDate) {
      skipped += 1;
      continue;
    }
    inputs.push(draft);
    materializedRuleIds.add(rule.id);
  }

  const created = await insertTransactionsAtomically(db, inputs);
  return { created, skipped };
}

export async function materializeRecurringRulesForMonth(
  db: AppDatabase,
  targetMonth: YearMonth,
  options: { throughDate?: string } = {},
): Promise<RecurringMaterializationResult> {
  assertYearMonth(targetMonth);

  let inFlightByMonth = inFlightByDatabase.get(db);
  if (!inFlightByMonth) {
    inFlightByMonth = new Map();
    inFlightByDatabase.set(db, inFlightByMonth);
  }
  // 同じ月への current/full 呼び出しも直列化し、読み取りと挿入の間で重複させない。
  const previous = inFlightByMonth.get(targetMonth);
  const operation = (async () => {
    if (previous) {
      try {
        await previous;
      } catch {
        // 先行処理の失敗は先行呼び出しへ返し、この呼び出しは最新 DB 状態から再試行する。
      }
    }
    return materialize(db, targetMonth, options.throughDate);
  })();
  inFlightByMonth.set(targetMonth, operation);
  try {
    return await operation;
  } finally {
    if (inFlightByMonth.get(targetMonth) === operation) {
      inFlightByMonth.delete(targetMonth);
    }
    if (inFlightByMonth.size === 0) inFlightByDatabase.delete(db);
  }
}

/**
 * 端末ローカル日付の当月について、発生日が今日以前のルールだけを実取引化する。
 * 過去月の未生成取引は補完しない。catch-up が必要なら対象月を明示して
 * materializeRecurringRulesForMonth を呼ぶ。
 */
export function materializeRecurringRulesForCurrentMonth(
  db: AppDatabase,
  now: Date = new Date(),
): Promise<RecurringMaterializationResult> {
  return materializeRecurringRulesForMonth(db, localYearMonth(now), {
    throughDate: localIsoDate(now),
  });
}
