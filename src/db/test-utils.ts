// テスト用の DB セットアップ。better-sqlite3（Node 上で動く SQLite）を使い、
// drizzle/ 配下に生成済みの本番と同一のマイグレーションを適用する。
// 本ファイルはプロダクションコードからは参照しない（*.test.ts 専用）。
// better-sqlite3（Node ネイティブ）はここに閉じ込め、アプリのバンドルに載せない。
import BetterSqlite3 from "better-sqlite3";
import { drizzle as drizzleBetterSqlite3 } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { type AppDatabase, schema } from "./client";

/** テスト/CI 用: better-sqlite3（Node 上の SQLite）から drizzle インスタンスを作る。 */
export function createNodeDatabase(nativeDb: BetterSqlite3.Database): AppDatabase {
  return drizzleBetterSqlite3(nativeDb, { schema });
}

/** インメモリ SQLite に本番と同一のマイグレーションを適用した DB を作る。 */
export function createTestDb(): AppDatabase {
  const nativeDb = new BetterSqlite3(":memory:");
  const db = createNodeDatabase(nativeDb);
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return db;
}
