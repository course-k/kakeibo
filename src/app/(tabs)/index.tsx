// ホーム画面スタブ（M4 が実装する）。
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useDb } from '@/db/provider';

export default function HomeScreen() {
  // useDb() を1回呼び、DbProvider からの配線が通っていることを示す。
  useDb();

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText type="title">ホーム</ThemedText>
        <ThemedText>M4 で実装</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}
