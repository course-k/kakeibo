// drizzle/migrations.js（drizzle-kit generate 生成物）が `import ... from './0000_xxx.sql'`
// という形で SQL ファイルを直接 import する（Metro のアセット変換に依存）。
// tsc は素の .sql import を解決できないため、ここで型だけ用意する。
declare module '*.sql' {
  const content: string;
  export default content;
}
