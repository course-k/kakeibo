// DB ドライバのシーム。
// 本番は expo-sqlite（React Native 実機）、テスト/CI は better-sqlite3（Node/vitest）を使う。
// expo-sqlite のネイティブモジュールは vitest（Node）では動かないため、ドライバの型を
// 共通化しリポジトリ層はどちらの DB ハンドルでも同じ関数で動くようにする。
//
// 両ドライバとも drizzle-orm 上では resultKind='sync' の BaseSQLiteDatabase を返す
// （expo-sqlite・better-sqlite3 いずれも同期 API をラップしているため）。
// TRunResult（各ドライバ固有の実行結果型）だけが異なるので、そこを any にして
// リポジトリ層が両者を区別せず扱えるようにしている。
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { drizzle as drizzleBetterSqlite3 } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleExpo } from "drizzle-orm/expo-sqlite/driver";
import type BetterSqlite3Database from "better-sqlite3";
import type { SQLiteDatabase as ExpoSQLiteDatabaseHandle } from "expo-sqlite";
import * as schema from "./schema";

/** リポジトリ層が要求する DB ハンドルの共通面（ドライバのシーム）。 */
export type AppDatabase = BaseSQLiteDatabase<"sync", any, typeof schema>;

/** 本番用: expo-sqlite のネイティブ DB ハンドルから drizzle インスタンスを作る。 */
export function createExpoDatabase(nativeDb: ExpoSQLiteDatabaseHandle): AppDatabase {
  return drizzleExpo(nativeDb, { schema });
}

/** テスト/CI 用: better-sqlite3（Node 上で動く SQLite）から drizzle インスタンスを作る。 */
export function createNodeDatabase(nativeDb: BetterSqlite3Database.Database): AppDatabase {
  return drizzleBetterSqlite3(nativeDb, { schema });
}

export { schema };
