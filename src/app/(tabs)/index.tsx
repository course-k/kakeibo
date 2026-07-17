import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listAccounts } from '@/db/accounts-repository';
import { listCards } from '@/db/cards-repository';
import { useDb } from '@/db/provider';
import { listTransactions } from '@/db/transactions-repository';
import {
  buildHomeViewModel,
  type HomeViewModel,
  type TransactionHistoryItem,
} from '@/features/home/view-model';
import { materializeRecurringRulesForCurrentMonth } from '@/features/recurring/materialize-month';

export default function HomeScreen() {
  const db = useDb();
  const [viewModel, setViewModel] = useState<HomeViewModel | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadHome() {
        try {
          await materializeRecurringRulesForCurrentMonth(db);
          const [accounts, cards, transactions] = await Promise.all([
            listAccounts(db, { includeArchived: true }),
            listCards(db),
            listTransactions(db),
          ]);
          if (!active) return;
          setViewModel(buildHomeViewModel(accounts, cards, transactions, getTodayIsoDate()));
          setErrorMessage(null);
        } catch (error) {
          if (!active) return;
          setErrorMessage(
            error instanceof Error ? error.message : 'ホームの読み込みに失敗しました'
          );
        }
      }

      void loadHome();

      return () => {
        active = false;
      };
    }, [db])
  );

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">ホーム</ThemedText>

          <View style={styles.quickActions}>
            <Pressable style={styles.inputButton} onPress={() => router.push('/input')}>
              <ThemedText style={styles.inputButtonText}>支出を記録</ThemedText>
            </Pressable>
            <Pressable style={styles.transferButton} onPress={() => router.push('/transfer')}>
              <ThemedText style={styles.transferButtonText}>予算を移す</ThemedText>
            </Pressable>
          </View>

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
      {viewModel.budgetAccounts.length === 0 ? (
        <ThemedView type="backgroundElement" style={styles.emptyPanel}>
          <ThemedText type="smallBold">最初に予算を作成してください</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            食費や日用品など、使い道ごとの予算を設定すると支出を記録できます。
          </ThemedText>
          <Pressable style={styles.settingsButton} onPress={() => router.push('/settings')}>
            <ThemedText style={styles.settingsButtonText}>設定を開く</ThemedText>
          </Pressable>
        </ThemedView>
      ) : null}

      <ThemedView type="backgroundElement" style={styles.panel}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          使える合計
        </ThemedText>
        <ThemedText type="subtitle">{formatYen(viewModel.savingsAmount)}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          予算の残り
        </ThemedText>
        {viewModel.budgetAccounts.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            予算がまだありません
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
          カード支払準備
        </ThemedText>
        {viewModel.cards.length === 0 ? (
          <ThemedView type="backgroundElement" style={styles.emptyRow}>
            <ThemedText type="small" themeColor="textSecondary">
              カードを使う場合は設定から追加できます
            </ThemedText>
            <Pressable onPress={() => router.push('/settings')}>
              <ThemedText type="linkPrimary">カードを設定</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          viewModel.cards.map((card) => (
            <Pressable key={card.id} onPress={() => router.push(`/card/${card.id}`)}>
              <ThemedView type="backgroundElement" style={styles.cardRow}>
                <View style={styles.cardText}>
                  <ThemedText>{card.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    毎月 {card.debitDay} 日引き落とし
                  </ThemedText>
                </View>
                <View style={styles.cardAmount}>
                  <ThemedText type="small" themeColor="textSecondary">
                    支払い準備済み
                  </ThemedText>
                  <ThemedText style={card.needsAttention ? styles.warningText : undefined}>
                    {formatYen(card.preparedAmount)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    今回分 {formatYen(card.currentAmount)}
                  </ThemedText>
                  {card.needsAttention ? (
                    <ThemedText type="small" style={styles.warningText}>
                      要確認
                    </ThemedText>
                  ) : null}
                </View>
              </ThemedView>
            </Pressable>
          ))
        )}
      </ThemedView>

      <ThemedView style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            最近の記録
          </ThemedText>
          <Pressable onPress={() => router.push('/history')}>
            <ThemedText type="linkPrimary">すべて見る</ThemedText>
          </Pressable>
        </View>
        {viewModel.recentTransactions.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            まだ記録がありません
          </ThemedText>
        ) : (
          viewModel.recentTransactions.map((item) => (
            <RecentTransactionRow key={item.id} item={item} />
          ))
        )}
      </ThemedView>
    </>
  );
}

function RecentTransactionRow({ item }: { item: TransactionHistoryItem }) {
  const content = (
    <ThemedView type="backgroundElement" style={styles.historyRow}>
      <View style={styles.historyText}>
        <ThemedText type="smallBold">{item.typeLabel}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatShortDate(item.date)} ・ {item.accountLabel}
        </ThemedText>
      </View>
      <ThemedText>{formatHistoryAmount(item)}</ThemedText>
    </ThemedView>
  );

  if (!item.editable) return content;

  return (
    <Pressable
      onPress={() =>
        item.type === 'expense_cash' || item.type === 'expense_card'
          ? router.push({ pathname: '/input', params: { transactionId: item.id } })
          : router.push(`/transaction/${item.id}`)
      }>
      {content}
    </Pressable>
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

function formatHistoryAmount(item: TransactionHistoryItem): string {
  const prefix = item.amountDirection === 'in' ? '+' : item.amountDirection === 'out' ? '-' : '';
  return `${prefix}${formatYen(item.amount)}`;
}

function formatShortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
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
  quickActions: {
    flexDirection: 'row',
    gap: 10,
  },
  inputButton: {
    alignItems: 'center',
    backgroundColor: '#3c87f7',
    borderRadius: 8,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  inputButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  transferButton: {
    alignItems: 'center',
    borderColor: '#3c87f7',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  transferButtonText: {
    color: '#3c87f7',
    fontWeight: '700',
  },
  panel: {
    borderRadius: 8,
    gap: 8,
    padding: 16,
  },
  emptyPanel: {
    borderRadius: 8,
    gap: 10,
    padding: 16,
  },
  settingsButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#3c87f7',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  settingsButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  emptyRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  historyRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  historyText: {
    flex: 1,
    gap: 2,
  },
});
