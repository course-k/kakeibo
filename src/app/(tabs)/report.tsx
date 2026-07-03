// レポート画面スタブ（M6 が実装する）。
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function ReportScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText type="title">レポート</ThemedText>
        <ThemedText>M6 で実装</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}
