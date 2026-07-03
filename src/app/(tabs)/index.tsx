import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listAccounts } from '@/db/accounts-repository';
import { listCards } from '@/db/cards-repository';
import { useDb } from '@/db/provider';
import { listTransactions } from '@/db/transactions-repository';
import { buildHomeViewModel, type HomeViewModel } from '@/features/home/view-model';

export default function HomeScreen() {
  const db = useDb();
  const [viewModel, setViewModel] = useState<HomeViewModel | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadHome() {
      try {
        const [accounts, cards, transactions] = await Promise.all([
          listAccounts(db, { includeArchived: false }),
          listCards(db),
          listTransactions(db),
        ]);
        if (!active) return;
        setViewModel(buildHomeViewModel(accounts, cards, transactions, getTodayIsoDate()));
        setErrorMessage(null);
      } catch (error) {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : 'ホームの読み込みに失敗しました');
      }
    }

    void loadHome();

    return () => {
      active = false;
    };
  }, [db]);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedView style={styles.header}>
            <ThemedText type="subtitle">ホーム</ThemedText>
            <Pressable style={styles.inputButton} onPress={() => router.push('/input')}>
              <ThemedText style={styles.inputButtonText}>入力</ThemedText>
            </Pressable>
          </ThemedView>

          {errorMessage ? (
            <ThemedView type="backgroundElement" style={styles.panel}>
              <ThemedText>読み込みエラー</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {errorMessage}
              </ThemedText>
            </ThemedView>
          ) : null}

          {!viewModel && !errorMessage ? (
            <ThemedView type="backgroundElement" style={styles.panel}>
              <ThemedText>読み込み中</ThemedText>
            </ThemedView>
          ) : null}

          {viewModel ? <HomeContent viewModel={viewModel} /> : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function HomeContent({ viewModel }: { viewModel: HomeViewModel }) {
  return (
    <>
      <ThemedView type="backgroundElement" style={styles.panel}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          貯まり合計
        </ThemedText>
        <ThemedText type="subtitle">{formatYen(viewModel.savingsAmount)}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          予算口座の残額
        </ThemedText>
        {viewModel.budgetAccounts.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            予算口座がありません
          </ThemedText>
        ) : (
          viewModel.budgetAccounts.map((account) => (
            <ThemedView key={account.id} type="backgroundElement" style={styles.row}>
              <ThemedText>{account.name}</ThemedText>
              <ThemedText>{formatYen(account.remainingAmount)}</ThemedText>
            </ThemedView>
          ))
        )}
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          カードの引き落とし準備
        </ThemedText>
        {viewModel.cards.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            カードがありません
          </ThemedText>
        ) : (
          viewModel.cards.map((card) => (
            <ThemedView key={card.id} type="backgroundElement" style={styles.cardRow}>
              <View style={styles.cardText}>
                <ThemedText>{card.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  毎月 {card.debitDay} 日引き落とし
                </ThemedText>
              </View>
              <View style={styles.cardAmount}>
                <ThemedText style={card.needsAttention ? styles.warningText : undefined}>
                  {formatYen(card.preparedAmount)}
                </ThemedText>
                {card.needsAttention ? (
                  <ThemedText type="small" style={styles.warningText}>
                    要確認
                  </ThemedText>
                ) : null}
              </View>
            </ThemedView>
          ))
        )}
      </ThemedView>
    </>
  );
}

function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatYen(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}¥${Math.abs(amount).toLocaleString('ja-JP')}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: 24,
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  inputButton: {
    alignItems: 'center',
    backgroundColor: '#3c87f7',
    borderRadius: 8,
    minHeight: 44,
    minWidth: 88,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  inputButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  panel: {
    borderRadius: 8,
    gap: 8,
    padding: 16,
  },
  section: {
    gap: 10,
  },
  row: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardAmount: {
    alignItems: 'flex-end',
    gap: 2,
  },
  warningText: {
    color: '#c2410c',
  },
});
