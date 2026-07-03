// 金額まわりの純粋関数。SQLite にも React にも依存しない。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.3（不変条件）・§4（技術構成）

/**
 * 金額が「正の整数円」として妥当かを検証する。
 * 家計簿の金額は円単位の整数のみを許容し、0 以下・非整数・非有限値は不正とする。
 */
export function isValidAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0;
}
