// カードの請求分（今回/次回）導出。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.2 導出値 / §6 締め日は翌月一括払いのみ
//
// 【解釈】spec は「直近の締め日以前の期間に積んだ未消し込み分を取引日で分計」とのみ
// 記述しており、card_debit（消し込み）がどの取引を消すかは明記されていない。
// 本実装は「消し込みは常に直近の締め日までに積んだ分（今回請求分）から先に減らす」
// という FIFO 的な前提を置く。まだ締まっていない分（次回以降分）は消し込みの対象外。
import { deriveBalance } from "./balance";
import { clampDayToMonth, addMonths, formatIsoDate, parseIsoDate, compareIsoDate } from "./date-utils";
import type { Card, Transaction } from "./types";

export type CardStatement = {
  /** 今回請求分。直近の締め日までに積んだ未消し込み分（0 未満にはならない）。 */
  currentAmount: number;
  /** 次回以降分。直近の締め日より後に積んだ、まだ締まっていない分。 */
  nextAmount: number;
  /** 決済口座残高の全額（deriveBalance による導出値。currentAmount + nextAmount の参照元）。 */
  settlementBalance: number;
};

function isActive(tx: Transaction): boolean {
  return tx.deletedAt === null;
}

/**
 * today 時点で「直近に到来した締め日」の日付（'YYYY-MM-DD'）を返す。
 * 締め日当日は含む（当日以前）。closingDay の月末丸めを考慮する。
 */
function lastClosingDateOnOrBefore(today: string, closingDay: number): string {
  const { year, month } = parseIsoDate(today);
  const dayThisMonth = clampDayToMonth(year, month, closingDay);
  const candidateThisMonth = formatIsoDate(year, month, dayThisMonth);
  if (compareIsoDate(candidateThisMonth, today) <= 0) {
    return candidateThisMonth;
  }
  const prev = addMonths(year, month, -1);
  const dayPrevMonth = clampDayToMonth(prev.year, prev.month, closingDay);
  return formatIsoDate(prev.year, prev.month, dayPrevMonth);
}

/**
 * カードの今回請求分/次回以降分を導出する。
 * 締め日設定時: 直近の締め日以前に積んだ expense_card 合計から card_debit 合計を差し引いた額を
 * 今回請求分とし（0 未満は 0 に丸める）、締め日より後に積んだ expense_card 合計を次回以降分とする。
 * 締め日未設定時: 決済口座残高の全額を今回請求分（準備額）とし、次回以降分は 0 とする。
 */
export function deriveCardStatement(
  card: Card,
  transactions: Transaction[],
  today: string
): CardStatement {
  const settlementBalance = deriveBalance(card.settlementAccountId, transactions);

  if (card.closingDay === null) {
    return { currentAmount: settlementBalance, nextAmount: 0, settlementBalance };
  }

  const lastClosingDate = lastClosingDateOnOrBefore(today, card.closingDay);

  let billedToDate = 0;
  let unbilled = 0;
  let paid = 0;

  for (const tx of transactions) {
    if (!isActive(tx) || tx.cardId !== card.id) continue;
    if (tx.type === "expense_card") {
      if (compareIsoDate(tx.date, lastClosingDate) <= 0) {
        billedToDate += tx.amount;
      } else {
        unbilled += tx.amount;
      }
    } else if (tx.type === "card_debit") {
      paid += tx.amount;
    }
  }

  const currentAmount = Math.max(billedToDate - paid, 0);
  const nextAmount = unbilled;

  return { currentAmount, nextAmount, settlementBalance };
}
