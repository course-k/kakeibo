// 定期取引ルールから対象月の取引案を展開する。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1 recurring_rules
//
// 【解釈】展開結果は「未保存の案」であり、id・created_at・updated_at・deleted_at は
// 呼び出し側（永続層）の責務として付与される想定のため、ここでは含めない。
import { addMonths, clampDayToMonth, compareYearMonth, formatIsoDate, parseYearMonth } from "./date-utils";
import type { MonthRange, RecurringRule, Transaction } from "./types";

/** id・created_at・updated_at・deleted_at を除いた、未保存の取引案。 */
export type DraftTransaction = Omit<Transaction, "id" | "createdAt" | "updatedAt" | "deletedAt">;

/**
 * 定期取引ルールを monthRange（両端含む）の各月に展開し、取引案の配列を返す。
 * dayOfMonth はその月に存在しない日（31 日など）の場合、月末に丸める。
 */
export function expandRecurring(rule: RecurringRule, monthRange: MonthRange): DraftTransaction[] {
  const drafts: DraftTransaction[] = [];
  let cursor = parseYearMonth(monthRange.from);
  const toYm = monthRange.to;

  while (compareYearMonth(`${cursor.year}-${String(cursor.month).padStart(2, "0")}`, toYm) <= 0) {
    const day = clampDayToMonth(cursor.year, cursor.month, rule.dayOfMonth);
    const date = formatIsoDate(cursor.year, cursor.month, day);

    drafts.push({
      date,
      amount: rule.amount,
      type: rule.type,
      fromAccountId: rule.fromAccountId,
      toAccountId: rule.toAccountId,
      cardId: rule.cardId,
      categoryId: rule.categoryId,
      memo: rule.memo,
      recurringRuleId: rule.id,
    });

    cursor = addMonths(cursor.year, cursor.month, 1);
  }

  return drafts;
}
