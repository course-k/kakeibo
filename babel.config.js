// Drizzle の SQL マイグレーションを Metro bundle に文字列として取り込む。
// metro.config.js の sourceExts 設定と対で必要になる。
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
