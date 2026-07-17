import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listAccounts } from '@/db/accounts-repository';
import { listCards } from '@/db/cards-repository';
import { useDb } from '@/db/provider';
import { getTransactionById, softDeleteTransaction } from '@/db/transactions-repository';
import { buildTransactionHistoryItems, type TransactionHistoryItem } from '@/features/home/view-model';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactionId = Array.isArray(id) ? id[0] : id;
  const db = useDb();
  const router = useRouter();
  const [item, setItem] = useState<TransactionHistoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [archivedBudgetNames, setArchivedBudgetNames] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!transactionId) {
          setError('記録が見つかりません');
          setLoading(false);
          return;
        }
        try {
          const [transaction, accounts, cards] = await Promise.all([
            getTransactionById(db, transactionId),
            listAccounts(db, { includeArchived: true }),
            listCards(db),
          ]);
          if (!active) return;
          if (!transaction) {
            setError('記録が見つかりません');
          } else {
            setItem(buildTransactionHistoryItems(accounts, cards, [transaction])[0]);
            const referencedAccountIds = new Set(
              [transaction.fromAccountId, transaction.toAccountId].filter(
                (accountId): accountId is string => accountId !== null
              )
            );
            setArchivedBudgetNames(
              accounts
                .filter(
                  (account) =>
                    referencedAccountIds.has(account.id) &&
                    account.type === 'budget' &&
                    account.archivedAt !== null
                )
                .map((account) => account.name)
            );
          }
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : '読み込みに失敗しました');
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [db, transactionId])
  );

  function confirmDelete() {
    if (!transactionId) return;
    Alert.alert('この記録を削除しますか', '残高と集計から取り除かれます。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await softDeleteTransaction(db, transactionId);
              router.back();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '削除できませんでした');
            }
          })();
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.content}>
          {loading ? <ActivityIndicator /> : null}
          {error ? <ThemedText style={styles.warning}>{error}</ThemedText> : null}
          {item ? (
            <>
              <ThemedText type="title">{item.typeLabel}</ThemedText>
              <ThemedView type="backgroundElement" style={styles.summary}>
                <Row label="日付" value={item.date} />
                <Row label="予算・カード" value={item.accountLabel} />
                <Row label="金額" value={`${item.amount.toLocaleString('ja-JP')}円`} />
                {item.memo ? <Row label="メモ" value={item.memo} /> : null}
              </ThemedView>
              <ThemedText type="small" themeColor="textSecondary">
                金額を直す場合は削除し、正しい内容でもう一度記録してください。
              </ThemedText>
              {archivedBudgetNames.length > 0 ? (
                <ThemedView type="backgroundElement" style={styles.archivedNotice}>
                  <ThemedText type="smallBold">
                    {archivedBudgetNames.join('・')} は終了済みです
                  </ThemedText>
                  <ThemedText type="small">
                    過去の残高を隠さないため、削除の前に予算を再開してください。
                  </ThemedText>
                  <Pressable
                    style={styles.settingsButton}
                    onPress={() => router.push('/(tabs)/settings')}>
                    <ThemedText type="smallBold">設定で予算を再開</ThemedText>
                  </Pressable>
                </ThemedView>
              ) : null}
              <Pressable
                style={styles.deleteButton}
                onPress={confirmDelete}
                disabled={archivedBudgetNames.length > 0}>
                <ThemedText style={styles.deleteText}>この記録を削除</ThemedText>
              </Pressable>
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText style={styles.rowValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: { gap: 20, padding: 20 },
  summary: { borderRadius: 12, gap: 12, padding: 16 },
  row: { flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  rowValue: { flex: 1, textAlign: 'right' },
  deleteButton: { alignItems: 'center', borderColor: '#b42318', borderRadius: 10, borderWidth: 1, padding: 14 },
  deleteText: { color: '#b42318', fontWeight: '700' },
  archivedNotice: { borderRadius: 10, gap: 10, padding: 14 },
  settingsButton: { alignItems: 'center', backgroundColor: '#e5e7eb', borderRadius: 8, padding: 12 },
  warning: { color: '#c2410c' },
});
