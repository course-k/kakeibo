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
config.resolver.assetExts.push('wasm');

// expo-sqlite の Web worker は SharedArrayBuffer を使うため、開発サーバーを
// cross-origin isolated にする。ネイティブ bundle には影響しない。
const defaultEnhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhancedMiddleware = defaultEnhanceMiddleware
    ? defaultEnhanceMiddleware(middleware, metroServer)
    : middleware;
  return (request, response, next) => {
    response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return enhancedMiddleware(request, response, next);
  };
};

module.exports = config;
