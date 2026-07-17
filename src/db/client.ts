// DB ドライバのシーム。
// 本番は expo-sqlite（React Native 実機）。テスト/CI 用の better-sqlite3 は
// test-utils.ts に分離し、Node ネイティブモジュールを Metro bundle に載せない。
//
// 両ドライバとも drizzle-orm 上では resultKind='sync' の BaseSQLiteDatabase を返す。
// TRunResult（各ドライバ固有の実行結果型）だけが異なるので、そこを any にして
// リポジトリ層が両者を区別せず扱えるようにしている。
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { drizzle as drizzleExpo } from "drizzle-orm/expo-sqlite/driver";
import type { SQLiteDatabase as ExpoSQLiteDatabaseHandle } from "expo-sqlite";
import * as schema from "./schema";

/** リポジトリ層が要求する DB ハンドルの共通面（ドライバのシーム）。 */
export type AppDatabase = BaseSQLiteDatabase<"sync", any, typeof schema>;

/** 本番用: expo-sqlite のネイティブ DB ハンドルから drizzle インスタンスを作る。 */
export function createExpoDatabase(nativeDb: ExpoSQLiteDatabaseHandle): AppDatabase {
  return drizzleExpo(nativeDb, { schema });
}

export { schema };
