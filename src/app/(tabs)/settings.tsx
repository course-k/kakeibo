import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { insertAccount, listAccounts, updateAccount } from '@/db/accounts-repository';
import { listCards } from '@/db/cards-repository';
import { exportData, importData } from '@/db/export-import';
import { useDb } from '@/db/provider';
import { deleteRecurringRule, insertRecurringRule, listRecurringRules } from '@/db/recurring-rules-repository';
import { insertTransaction, listTransactions } from '@/db/transactions-repository';
import type { Account, Card, RecurringRule, Transaction } from '@/domain/types';
import { buildMonthlyBudgetIncomeRule } from '@/features/recurring/monthly-budget';
import { canArchiveAccount } from '@/features/settings/account-archive';
import { createCardWithSettlementAccount } from '@/features/settings/cards';
import { buildInitialBalanceAdjustment } from '@/features/settings/initial-balance';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseAmount(value: string): number {
  return Number.parseInt(value.replace(/,/g, ''), 10);
}

function yen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`;
}

export default function SettingsScreen() {
  const db = useDb();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountBudget, setAccountBudget] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardClosingDay, setCardClosingDay] = useState('');
  const [cardDebitDay, setCardDebitDay] = useState('27');
  const [ruleAccountId, setRuleAccountId] = useState('');
  const [ruleAmount, setRuleAmount] = useState('');
  const [adjustmentAccountId, setAdjustmentAccountId] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [backupJson, setBackupJson] = useState('');

  const budgetAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'budget' && account.archivedAt === null),
    [accounts]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const [accountRows, cardRows, ruleRows, transactionRows] = await Promise.all([
      listAccounts(db, { includeArchived: true }),
      listCards(db),
      listRecurringRules(db),
      listTransactions(db),
    ]);
    setAccounts(accountRows);
    setCards(cardRows);
    setRules(ruleRows);
    setTransactions(transactionRows);
    setRuleAccountId((current) => current || accountRows.find((account) => account.type === 'budget')?.id || '');
    setAdjustmentAccountId((current) => current || accountRows[0]?.id || '');
    setLoading(false);
  }, [db]);

  useEffect(() => {
    const timer = setTimeout(() => {
      reload().catch((error: Error) => {
        setMessage(error.message);
        setLoading(false);
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [reload]);

  async function createBudgetAccount() {
    const monthlyBudget = parseAmount(accountBudget || '0');
    if (!accountName.trim() || Number.isNaN(monthlyBudget)) return;
    await insertAccount(db, {
      name: accountName.trim(),
      type: 'budget',
      monthlyBudget,
      ownerId: null,
      sortOrder: accounts.length,
      archivedAt: null,
    });
    setAccountName('');
    setAccountBudget('');
    setMessage('予算口座を追加しました');
    await reload();
  }

  async function archiveAccount(account: Account) {
    if (!canArchiveAccount(account.id, transactions)) {
      setMessage('残高が 0 の口座だけアーカイブできます');
      return;
    }
    await updateAccount(db, account.id, { archivedAt: today() });
    setMessage('口座をアーカイブしました');
    await reload();
  }

  async function createCard() {
    const debitDay = parseAmount(cardDebitDay);
    const closingDay = cardClosingDay.trim() ? parseAmount(cardClosingDay) : null;
    if (!cardName.trim() || Number.isNaN(debitDay) || (closingDay !== null && Number.isNaN(closingDay))) return;
    await createCardWithSettlementAccount(db, {
      name: cardName.trim(),
      closingDay,
      debitDay,
      sortOrder: accounts.length,
    });
    setCardName('');
    setCardClosingDay('');
    setCardDebitDay('27');
    setMessage('カードと決済口座を追加しました');
    await reload();
  }

  async function createMonthlyRule() {
    const amount = parseAmount(ruleAmount);
    if (!ruleAccountId || Number.isNaN(amount)) return;
    await insertRecurringRule(db, buildMonthlyBudgetIncomeRule({ budgetAccountId: ruleAccountId, amount }));
    setRuleAmount('');
    setMessage('月初充当ルールを追加しました');
    await reload();
  }

  async function addInitialBalance() {
    const amount = parseAmount(adjustmentAmount);
    if (!adjustmentAccountId || Number.isNaN(amount) || amount === 0) return;
    await insertTransaction(
      db,
      buildInitialBalanceAdjustment({ accountId: adjustmentAccountId, amount, date: today() })
    );
    setAdjustmentAmount('');
    setMessage('初期残高 adjustment を追加しました');
    await reload();
  }

  async function exportJson() {
    const data = await exportData(db);
    setBackupJson(JSON.stringify(data, null, 2));
    setMessage('JSON を生成しました');
  }

  async function importJson() {
    try {
      await importData(db, JSON.parse(backupJson));
      setMessage('JSON を取り込みました');
      await reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'import failed';
      Alert.alert('Import failed', message);
      setMessage(message);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">設定</ThemedText>
          {loading ? <ActivityIndicator /> : null}
          {message ? <ThemedText>{message}</ThemedText> : null}

          <View style={styles.section}>
            <ThemedText type="subtitle">予算口座</ThemedText>
            <TextInput style={styles.input} value={accountName} onChangeText={setAccountName} placeholder="口座名" />
            <TextInput
              keyboardType="number-pad"
              style={styles.input}
              value={accountBudget}
              onChangeText={setAccountBudget}
              placeholder="月初充当額"
            />
            <Button title="追加" onPress={createBudgetAccount} />
            {accounts
              .filter((account) => account.type === 'budget')
              .map((account) => (
                <View key={account.id} style={styles.row}>
                  <ThemedText style={styles.rowText}>
                    {account.name} / {yen(account.monthlyBudget)}
                    {account.archivedAt ? ` / archived ${account.archivedAt}` : ''}
                  </ThemedText>
                  {!account.archivedAt ? <Button title="アーカイブ" onPress={() => archiveAccount(account)} /> : null}
                </View>
              ))}
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle">カード</ThemedText>
            <TextInput style={styles.input} value={cardName} onChangeText={setCardName} placeholder="カード名" />
            <TextInput
              keyboardType="number-pad"
              style={styles.input}
              value={cardClosingDay}
              onChangeText={setCardClosingDay}
              placeholder="締め日（空欄可）"
            />
            <TextInput
              keyboardType="number-pad"
              style={styles.input}
              value={cardDebitDay}
              onChangeText={setCardDebitDay}
              placeholder="引き落とし日"
            />
            <Button title="カード追加" onPress={createCard} />
            {cards.map((card) => (
              <ThemedText key={card.id}>
                {card.name} / 締め日 {card.closingDay ?? '未設定'} / 引落 {card.debitDay} / 決済口座 {card.settlementAccountId}
              </ThemedText>
            ))}
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle">定期取引</ThemedText>
            {budgetAccounts.map((account) => (
              <Button key={account.id} title={`充当先: ${account.name}`} onPress={() => setRuleAccountId(account.id)} />
            ))}
            <ThemedText>選択中: {budgetAccounts.find((account) => account.id === ruleAccountId)?.name ?? 'なし'}</ThemedText>
            <TextInput
              keyboardType="number-pad"
              style={styles.input}
              value={ruleAmount}
              onChangeText={setRuleAmount}
              placeholder="月初充当額"
            />
            <Button title="月初充当ルール追加" onPress={createMonthlyRule} />
            {rules.map((rule) => (
              <View key={rule.id} style={styles.row}>
                <ThemedText style={styles.rowText}>
                  {rule.dayOfMonth}日 / {rule.type} / {yen(rule.amount)}
                </ThemedText>
                <Button title="削除" onPress={async () => { await deleteRecurringRule(db, rule.id); await reload(); }} />
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle">初期残高</ThemedText>
            {accounts.map((account) => (
              <Button key={account.id} title={`対象: ${account.name}`} onPress={() => setAdjustmentAccountId(account.id)} />
            ))}
            <TextInput
              keyboardType="numbers-and-punctuation"
              style={styles.input}
              value={adjustmentAmount}
              onChangeText={setAdjustmentAmount}
              placeholder="初期残高（マイナス可）"
            />
            <Button title="adjustment 追加" onPress={addInitialBalance} />
          </View>

          <View style={styles.section}>
            <ThemedText type="subtitle">エクスポート・インポート</ThemedText>
            <Button title="JSON 生成" onPress={exportJson} />
            <TextInput
              multiline
              numberOfLines={8}
              style={[styles.input, styles.jsonInput]}
              value={backupJson}
              onChangeText={setBackupJson}
              placeholder="バックアップ JSON"
            />
            <Button title="JSON 取り込み" onPress={importJson} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: { gap: 22, padding: 20 },
  section: { gap: 10 },
  input: { borderColor: '#9ca3af', borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  jsonInput: { minHeight: 160, textAlignVertical: 'top' },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  rowText: { flex: 1 },
});
