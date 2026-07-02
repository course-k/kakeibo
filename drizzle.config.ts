import { defineConfig } from "drizzle-kit";

// expo-sqlite 向けの Drizzle 設定（骨格）。
// 実際のマイグレーション生成・適用フローは M2 で確定させる。
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "expo",
});
