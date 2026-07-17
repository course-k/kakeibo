import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listAccounts } from '@/db/accounts-repository';
import { useDb } from '@/db/provider';
import { listTransactions } from '@/db/transactions-repository';
import type { Account, Transaction } from '@/domain/types';
import { summarizeMonthlyBudgetExpenses } from '@/features/report/aggregation';

function yen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`;
}

export default function ReportScreen() {
  const db = useDb();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [accountRows, transactionRows] = await Promise.all([
      listAccounts(db, { includeArchived: true }),
      listTransactions(db),
    ]);
    setAccounts(accountRows);
    setTransactions(transactionRows);
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        reload().catch(() => setLoading(false));
      }, 0);
      return () => clearTimeout(timer);
    }, [reload])
  );

  const summary = useMemo(
    () => summarizeMonthlyBudgetExpenses(accounts, transactions),
    [accounts, transactions]
  );
  const months = summary.monthlyTrend.map((item) => item.month);
  const activeMonth = selectedMonth ?? months.at(-1) ?? localYearMonth();
  const monthlyRows = summary.byAccount.filter((item) => item.month === activeMonth);
  const maxAccountAmount = Math.max(1, ...monthlyRows.map((item) => item.amount));
  const maxTrendAmount = Math.max(1, ...summary.monthlyTrend.map((item) => item.amount));

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">レポート</ThemedText>
          {loading ? <ActivityIndicator /> : null}

          <View style={styles.monthRow}>
            {months.map((month) => (
              <Pressable
                key={month}
                onPress={() => setSelectedMonth(month)}
                style={[styles.monthButton, month === activeMonth && styles.monthButtonActive]}>
                <ThemedText>{month}</ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle">予算口座別支出 {activeMonth}</ThemedText>
            {monthlyRows.length === 0 ? <ThemedText>支出はありません</ThemedText> : null}
            {monthlyRows.map((item) => (
              <View key={`${item.month}:${item.accountId}`} style={styles.barRow}>
                <ThemedText style={styles.barLabel}>{item.accountName}</ThemedText>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(item.amount / maxAccountAmount) * 100}%` }]} />
                </View>
                <ThemedText style={styles.amount}>{yen(item.amount)}</ThemedText>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle">月次推移</ThemedText>
            <View style={styles.trendChart}>
              {summary.monthlyTrend.map((item) => (
                <View key={item.month} style={styles.trendItem}>
                  <View style={[styles.trendBar, { height: `${(item.amount / maxTrendAmount) * 100}%` }]} />
                  <ThemedText style={styles.trendLabel}>{item.month.slice(5)}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function localYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: { gap: 20, padding: 20 },
  section: { gap: 12 },
  monthRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthButton: { borderColor: '#9ca3af', borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  monthButtonActive: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
  barRow: { gap: 6 },
  barLabel: { fontWeight: '600' },
  barTrack: { backgroundColor: '#e5e7eb', borderRadius: 4, height: 16, overflow: 'hidden' },
  barFill: { backgroundColor: '#2563eb', height: 16 },
  amount: { color: '#4b5563' },
  trendChart: { alignItems: 'flex-end', flexDirection: 'row', gap: 10, height: 160 },
  trendItem: { alignItems: 'center', flex: 1, gap: 6, height: 160, justifyContent: 'flex-end' },
  trendBar: { backgroundColor: '#16a34a', borderRadius: 4, minHeight: 2, width: '100%' },
  trendLabel: { fontSize: 12 },
});
