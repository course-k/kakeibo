// ドメインエンティティの型定義。DB スキーマそのものではなく、
// pure TS エンジンが扱うドメイン表現。
// 参照: lab/docs/design/kakeibo-v1-spec.md §2.1

/** 口座種別。budget=予算口座、card_settlement=クレカ決済用口座。 */
export type AccountType = "budget" | "card_settlement";

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  /** 月初充当額（円）。budget 口座のみ意味を持つ。0 可。 */
  monthlyBudget: number;
  /** v1 は常に null（v2 共有機能への備え）。 */
  ownerId: string | null;
  sortOrder: number;
  /** 'YYYY-MM-DD' | null。アーカイブ済みなら日付、有効なら null。 */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Card = {
  id: string;
  name: string;
  /** 決済用口座（card_settlement 型の Account）の id。1:1。 */
  settlementAccountId: string;
  /** 締め日（1-31）。31 は「月末」を表す。未設定可。 */
  closingDay: number | null;
  /** 引き落とし日（1-31）。31 は「月末」を表す。 */
  debitDay: number;
};

export type TransactionType =
  | "income"
  | "expense_cash"
  | "expense_card"
  | "transfer"
  | "card_debit"
  | "adjustment";

export type Transaction = {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 正の整数円。 */
  amount: number;
  type: TransactionType;
  fromAccountId: string | null;
  toAccountId: string | null;
  cardId: string | null;
  memo: string;
  recurringRuleId: string | null;
  createdAt: string;
  updatedAt: string;
  /** 論理削除日時（ISO）。null なら有効。 */
  deletedAt: string | null;
};

/**
 * 定期取引ルール。取引のテンプレート＋発生日（毎月 N 日）。
 * 月初の予算充当も type: 'income' のルールとして表現し、
 * 特別な月次リセット処理は持たない。
 */
export type RecurringRule = {
  id: string;
  type: TransactionType;
  amount: number;
  fromAccountId: string | null;
  toAccountId: string | null;
  cardId: string | null;
  memo: string;
  /** 毎月の発生日（1-31）。31 は「月末」を表す。 */
  dayOfMonth: number;
};

/** 'YYYY-MM' 形式の年月。 */
export type YearMonth = `${number}-${string}`;

/** expandRecurring が展開対象とする月の範囲（両端含む）。 */
export type MonthRange = {
  from: YearMonth;
  to: YearMonth;
};
