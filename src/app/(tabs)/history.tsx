import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listAccounts } from '@/db/accounts-repository';
import { listCards } from '@/db/cards-repository';
import { useDb } from '@/db/provider';
import { listTransactions } from '@/db/transactions-repository';
import {
  buildTransactionHistoryItems,
  type TransactionHistoryItem,
} from '@/features/home/view-model';

export default function HistoryScreen() {
  const db = useDb();
  const [items, setItems] = useState<TransactionHistoryItem[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadHistory() {
        try {
          const [accounts, cards, transactions] = await Promise.all([
            listAccounts(db, { includeArchived: true }),
            listCards(db),
            listTransactions(db),
          ]);
          if (!active) return;
          setItems(buildTransactionHistoryItems(accounts, cards, transactions));
          setErrorMessage(null);
        } catch (error) {
          if (!active) return;
          setErrorMessage(
            error instanceof Error ? error.message : '履歴の読み込みに失敗しました'
          );
        }
      }

      void loadHistory();

      return () => {
        active = false;
      };
    }, [db])
  );

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="subtitle">履歴</ThemedText>
            {items ? (
              <ThemedText type="small" themeColor="textSecondary">
                {items.length}件
              </ThemedText>
            ) : null}
          </View>

          {!items && !errorMessage ? <ActivityIndicator /> : null}

          {errorMessage ? (
            <ThemedView type="backgroundElement" style={styles.messagePanel}>
              <ThemedText type="smallBold">読み込みエラー</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {errorMessage}
              </ThemedText>
            </ThemedView>
          ) : null}

          {items?.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.messagePanel}>
              <ThemedText type="smallBold">まだ記録がありません</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                支出を記録すると、ここで確認・編集できます。
              </ThemedText>
              <Pressable style={styles.inputButton} onPress={() => router.push('/input')}>
                <ThemedText style={styles.inputButtonText}>支出を記録</ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          {items?.map((item) => <HistoryRow key={item.id} item={item} />)}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function HistoryRow({ item }: { item: TransactionHistoryItem }) {
  const content = (
    <ThemedView type="backgroundElement" style={styles.row}>
      <View style={styles.rowText}>
        <View style={styles.rowTitle}>
          <ThemedText type="smallBold">{item.typeLabel}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatJapaneseDate(item.date)}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {item.accountLabel}
        </ThemedText>
        {item.memo ? <ThemedText type="small">{item.memo}</ThemedText> : null}
      </View>
      <View style={styles.amountArea}>
        <ThemedText>{formatHistoryAmount(item)}</ThemedText>
        {item.editable ? (
          <ThemedText type="small" themeColor="textSecondary">
            {item.type === 'expense_cash' || item.type === 'expense_card' ? '編集 ›' : '詳細 ›'}
          </ThemedText>
        ) : null}
      </View>
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

function formatHistoryAmount(item: TransactionHistoryItem): string {
  const prefix = item.amountDirection === 'in' ? '+' : item.amountDirection === 'out' ? '-' : '';
  return `${prefix}¥${item.amount.toLocaleString('ja-JP')}`;
}

function formatJapaneseDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  messagePanel: {
    borderRadius: 8,
    gap: 10,
    padding: 16,
  },
  inputButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#3c87f7',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  inputButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  amountArea: {
    alignItems: 'flex-end',
    gap: 2,
  },
});
