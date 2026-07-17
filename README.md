# kakeibo（仮称: お金の貯まるアプリ）

クレカ支出を 1 操作で記録すると、予算口座の減額とカード決済用口座への取り分けが同時に済む封筒式家計簿。Expo（React Native）+ TypeScript、端末内 SQLite のみ（v1 はサーバーなし）。

- 仕様（単一ソース）: `lab/docs/design/kakeibo-v1-spec.md`
- UX 復旧設計・受入基準: `lab/docs/design/kakeibo-recovery-design.md`
- ロードマップ: `lab/docs/design/kakeibo-app-roadmap.md`
- v1 の完了定義: 作者がマネタメから完全に乗り換えられること

日常導線は「ホーム → 支出入力 → 履歴で確認・訂正」を中心に、予算間移動とカード引き落とし確認を備える。UI上の「予算」「カード支払準備」は用途別の仮想封筒であり、銀行口座そのものの残高管理は行わない。
