// UUID 生成。全テーブル UUID 主キー（spec §2.1）。
// React Native（Hermes）に Web Crypto の randomUUID が無い環境でも動くよう、
// crypto.randomUUID が使える場合はそれを使い、無ければ Math.random ベースの
// v4 相当の ID にフォールバックする（暗号強度は求めない用途）。
export function generateId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
