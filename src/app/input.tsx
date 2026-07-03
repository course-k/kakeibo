// 入力画面スタブ（M3 が実装する）。モーダル表示。
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function InputScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText type="title">入力</ThemedText>
        <ThemedText>M3 で実装</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}
