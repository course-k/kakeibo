// カード詳細画面スタブ（M5 が実装する）。動的ルート（/card/:id）。
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText type="title">カード詳細</ThemedText>
        <ThemedText>M5 で実装（id: {id}）</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}
