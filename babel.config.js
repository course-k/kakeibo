// Babel 設定。
// babel-plugin-inline-import で drizzle の .sql を文字列としてインライン化する
// （drizzle/migrations.js の `import m from './0000_*.sql'` を実機バンドルで解決するため。
//  metro.config.js の sourceExts への 'sql' 追加と併せて必要）。
// 参照: https://orm.drizzle.team/docs/get-started/expo-new
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
