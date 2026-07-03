// DB プロバイダ（土台所有ファイル）。
//
// M3〜M6 は本ファイルを直接編集せず、`useDb()` で db ハンドルを取り、
// `src/db` の各 repository（accounts-repository / cards-repository / transactions-repository /
// recurring-rules-repository 等）を呼び出す形で永続層を利用する。
//
// 起動時マイグレーションは drizzle-orm/expo-sqlite/migrator の useMigrations() で適用する。
// 適用中はローディング表示、失敗時はエラー表示を出し、成功後のみ children を描画する。
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync } from 'expo-sqlite';
import { createContext, useContext, type PropsWithChildren } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { createExpoDatabase, type AppDatabase } from '@/db/client';

import migrations from '../../drizzle/migrations';

const nativeDb = openDatabaseSync('kakeibo.db');
const db = createExpoDatabase(nativeDb);

const DbContext = createContext<AppDatabase | null>(null);

export function DbProvider({ children }: PropsWithChildren) {
  const { success, error } = useMigrations(db, migrations);

  if (error) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>DB migration failed: {error.message}</ThemedText>
      </ThemedView>
    );
  }

  if (!success) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

/** M3〜M6 の全画面が DB ハンドルを取る唯一の口。シグネチャは後続が依存する契約のため変えない。 */
export function useDb(): AppDatabase {
  const value = useContext(DbContext);
  if (!value) {
    throw new Error('useDb() must be used within <DbProvider>');
  }
  return value;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
