// 日付の境界正規化。DB へ書く／読む境界で 'YYYY-MM-DD'（ゼロ埋め）に統一する。
// 参照: lab/docs/design/kakeibo-v1-spec.md §5 M2 DoD
import { formatIsoDate, parseIsoDate } from "../domain/date-utils";

/**
 * 'YYYY-MM-DD' 形式の日付文字列をゼロ埋め正規化する。
 * '2026-7-3' のような非ゼロ埋め入力は '2026-07-03' に正す。
 * 数値として解釈できない入力は例外を投げる（不正な date を静かに通さない）。
 */
export function normalizeIsoDate(date: string): string {
  const parts = date.split("-");
  if (parts.length !== 3) {
    throw new Error(`invalid date format: ${date}`);
  }
  const { year, month, day } = parseIsoDate(date);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`invalid date format: ${date}`);
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`invalid date value: ${date}`);
  }
  return formatIsoDate(year, month, day);
}
