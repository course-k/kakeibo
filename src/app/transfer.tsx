import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { listAccounts } from '@/db/accounts-repository';
import { useDb } from '@/db/provider';
import { insertTransaction, listTransactions } from '@/db/transactions-repository';
import { deriveBalance } from '@/domain/balance';
import type { Account } from '@/domain/types';
import { todayIsoDate } from '@/features/input/input-logic';

export default function TransferScreen() {
  const db = useDb();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveLock = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const [allAccounts, transactions] = await Promise.all([
            listAccounts(db),
            listTransactions(db),
          ]);
          if (!active) return;
          const budgets = allAccounts.filter((account) => account.type === 'budget');
          setAccounts(budgets);
          setBalances(
            Object.fromEntries(
              budgets.map((account) => [
                account.id,
                deriveBalance(account.id, transactions, todayIsoDate()),
              ])
            )
          );
          setFromId((current) => current || budgets[0]?.id || '');
          setToId((current) => current || budgets[1]?.id || '');
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : '読み込みに失敗しました');
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [db])
  );

  const amount = useMemo(() => Number(amountText), [amountText]);
  const available = balances[fromId] ?? 0;
  const canSave =
    Number.isSafeInteger(amount) && amount > 0 && fromId !== '' && toId !== '' && fromId !== toId && amount <= available;

  async function save() {
    if (!canSave || saving || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      await insertTransaction(db, {
        date: todayIsoDate(),
        amount,
        type: 'transfer',
        fromAccountId: fromId,
        toAccountId: toId,
        cardId: null,
        memo: '予算を移動',
        recurringRuleId: null,
      });
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '予算を移せませんでした');
      setSaving(false);
      saveLock.current = false;
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <ThemedText type="title">予算を移す</ThemedText>
            <ThemedText themeColor="textSecondary">
              支出ではありません。使える金額を予算どうしで付け替えます。
            </ThemedText>
          </View>

          {loading ? <ActivityIndicator /> : null}
          {!loading && accounts.length < 2 ? (
            <View style={styles.emptyState}>
              <ThemedText>移動するには予算が2つ以上必要です。</ThemedText>
              <Pressable style={styles.saveButton} onPress={() => router.replace('/settings')}>
                <ThemedText style={styles.saveText}>設定で予算を追加</ThemedText>
              </Pressable>
            </View>
          ) : null}

          <ChoiceSection
            title="移動元"
            accounts={accounts}
            selectedId={fromId}
            balances={balances}
            onSelect={setFromId}
          />
          <ChoiceSection
            title="移動先"
            accounts={accounts.filter((account) => account.id !== fromId)}
            selectedId={toId}
            balances={balances}
            onSelect={setToId}
          />

          <View style={styles.amountSection}>
            <ThemedText type="smallBold">移す金額</ThemedText>
            <TextInput
              autoFocus
              keyboardType="number-pad"
              inputMode="numeric"
              value={amountText}
              onChangeText={setAmountText}
              placeholder="0"
              style={styles.amountInput}
            />
            {amount > available ? (
              <ThemedText style={styles.warning}>移動元の残り {yen(available)} を超えています。</ThemedText>
            ) : null}
          </View>

          {error ? <ThemedText style={styles.warning}>{error}</ThemedText> : null}
          <Pressable
            accessibilityRole="button"
            disabled={!canSave || saving}
            onPress={save}
            style={[styles.saveButton, (!canSave || saving) && styles.disabled]}>
            <ThemedText style={styles.saveText}>{saving ? '移動中…' : 'この内容で移す'}</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ChoiceSection({
  title,
  accounts,
  selectedId,
  balances,
  onSelect,
}: {
  title: string;
  accounts: Account[];
  selectedId: string;
  balances: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <View style={styles.choices}>
        {accounts.map((account) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedId === account.id }}
            accessibilityLabel={`${title} ${account.name}、残り${yen(balances[account.id] ?? 0)}`}
            key={account.id}
            onPress={() => onSelect(account.id)}
            style={[styles.choice, selectedId === account.id && styles.choiceSelected]}>
            <ThemedText type="smallBold">{account.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{yen(balances[account.id] ?? 0)}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function yen(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}¥${Math.abs(value).toLocaleString('ja-JP')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: { gap: Spacing.four, padding: Spacing.three, paddingBottom: Spacing.five },
  intro: { gap: Spacing.two },
  section: { gap: Spacing.two },
  choices: { gap: Spacing.two },
  choice: {
    alignItems: 'center',
    backgroundColor: Colors.light.backgroundElement,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.three,
  },
  choiceSelected: { backgroundColor: '#dbeafe', borderColor: '#2563eb', borderWidth: 1 },
  amountSection: { gap: Spacing.two },
  amountInput: {
    backgroundColor: Colors.light.backgroundElement,
    borderRadius: 12,
    fontSize: 32,
    fontWeight: '700',
    padding: Spacing.three,
    textAlign: 'right',
  },
  saveButton: { alignItems: 'center', backgroundColor: '#2563eb', borderRadius: 12, padding: Spacing.three },
  saveText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.4 },
  warning: { color: '#c2410c' },
  emptyState: { gap: Spacing.three },
});
