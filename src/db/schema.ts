// Drizzle スキーマ定義（骨格のみ）。
// テーブル本体は M2（永続層）で実装する。ここでは Drizzle + expo-sqlite の
// 配線が通ることを示すためのプレースホルダを置く。
//
// 参照: lab/docs/design/kakeibo-v1-spec.md §4 技術構成
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

// プレースホルダテーブル。M2 でドメインに沿ったスキーマに置き換える。
export const _placeholder = sqliteTable("_placeholder", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note"),
});
