// Metro 設定。
// drizzle-orm の expo-sqlite マイグレーションは drizzle/migrations.js が
// `./0000_*.sql` を import するため、Metro が .sql をソースとして解決できるよう
// sourceExts に 'sql' を追加する（この設定が無いと実機ビルドの bundle 時に
// "Unable to resolve module ./0000_*.sql" で失敗する。CI/vitest は
// migrationsFolder パス経由で読むため素通りし、Metro バンドル時のみ露見する）。
// 参照: https://orm.drizzle.team/docs/get-started/expo-new
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('sql');

module.exports = config;
