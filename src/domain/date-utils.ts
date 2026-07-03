// 日付まわりの純粋関数。'YYYY-MM-DD' / 'YYYY-MM' 文字列を timezone に依存せず
// 数値分解で扱う（Date オブジェクトのローカルタイムゾーン依存を避けるため）。
// 参照: lab/docs/design/kakeibo-v1-spec.md §6（締め日は翌月一括払いのみ）

/** 指定した年月の末日（28-31）を返す。month は 1-12。 */
export function daysInMonth(year: number, month: number): number {
  // 翌月 0 日目 = 当月末日
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 締め日/引き落とし日/定期取引の発生日（1-31）を、指定した年月に適用した際の
 * 実際の日に丸める。31 指定など、その月に存在しない日は月末に丸める。
 */
export function clampDayToMonth(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/** 'YYYY-MM-DD' を { year, month, day } に分解する（month は 1-12）。 */
export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** { year, month, day } を 'YYYY-MM-DD' に整形する（month は 1-12）。 */
export function formatIsoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM' を { year, month } に分解する（month は 1-12）。 */
export function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split("-").map(Number);
  return { year: y, month: m };
}

/** { year, month } を 'YYYY-MM' に整形する（month は 1-12）。 */
export function formatYearMonth(year: number, month: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  return `${y}-${m}`;
}

/** 年月を n ヶ月進める（n は負も可）。 */
export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const total = (year * 12 + (month - 1)) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { year: y, month: m };
}

/** 'YYYY-MM' の 2 点間を比較する（a < b なら負、等しければ 0、a > b なら正）。 */
export function compareYearMonth(a: string, b: string): number {
  const pa = parseYearMonth(a);
  const pb = parseYearMonth(b);
  if (pa.year !== pb.year) return pa.year - pb.year;
  return pa.month - pb.month;
}

/** 'YYYY-MM-DD' の 2 点間を比較する（文字列の辞書順＝日付順に一致する）。 */
export function compareIsoDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
