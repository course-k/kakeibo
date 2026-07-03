// テスト用の DB セットアップ。better-sqlite3（Node 上で動く SQLite）を使い、
// drizzle/ 配下に生成済みの本番と同一のマイグレーションを適用する。
// 本ファイルはプロダクションコードからは参照しない（*.test.ts 専用）。
import BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { createNodeDatabase, type AppDatabase } from "./client";

/** インメモリ SQLite に本番と同一のマイグレーションを適用した DB を作る。 */
export function createTestDb(): AppDatabase {
  const nativeDb = new BetterSqlite3(":memory:");
  const db = createNodeDatabase(nativeDb);
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return db;
}
