import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Alert, Button, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listAccounts } from '@/db/accounts-repository';
import { listCards } from '@/db/cards-repository';
import { exportData, importData } from '@/db/export-import';
import { useDb } from '@/db/provider';
import { listRecurringRules } from '@/db/recurring-rules-repository';
import { insertTransaction, listTransactions } from '@/db/transactions-repository';
import type { Account, Card, RecurringRule, Transaction } from '@/domain/types';
import { canArchiveAccount } from '@/features/settings/account-archive';
import { createCardWithSettlementAccount, updateCardSettings } from '@/features/settings/cards';
import { createBudgetWithMonthlyRule } from '@/features/settings/budgets';
import { archiveBudgetAndRules } from '@/features/settings/archive-budget';
import { reopenBudget } from '@/features/settings/reopen-budget';
import { updateBudgetAndMonthlyRule } from '@/features/settings/update-budget';
import { buildInitialBalanceAdjustment } from '@/features/settings/initial-balance';

type SettingsSection = 'budgets' | 'cards' | 'balances' | 'backup';

function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseInteger(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^-?\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

function parseDay(value: string): number | null {
  const day = parseInteger(value);
  return day !== null && day >= 1 && day <= 31 ? day : null;
}

function yen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`;
}

function dayLabel(day: number | null): string {
  if (day === null) return '未設定';
  return day === 31 ? '月末' : `${day}日`;
}

function displayAccountName(account: Account, cards: Card[]): string {
  if (account.type === 'budget') return account.name;
  const card = cards.find((item) => item.settlementAccountId === account.id);
  return card ? `${card.name} 支払準備` : 'カード支払準備';
}

export default function SettingsScreen() {
  const db = useDb();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [openSection, setOpenSection] = useState<SettingsSection | null>('budgets');
  const [accountName, setAccountName] = useState('');
  const [accountBudget, setAccountBudget] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardClosingDay, setCardClosingDay] = useState('');
  const [cardDebitDay, setCardDebitDay] = useState('27');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardName, setEditingCardName] = useState('');
  const [editingCardClosingDay, setEditingCardClosingDay] = useState('');
  const [editingCardDebitDay, setEditingCardDebitDay] = useState('');
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editingBudgetName, setEditingBudgetName] = useState('');
  const [editingBudgetAmount, setEditingBudgetAmount] = useState('');
  const [adjustmentAccountId, setAdjustmentAccountId] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [backupJson, setBackupJson] = useState('');

  const budgetAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'budget' && account.archivedAt === null),
    [accounts]
  );
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.archivedAt === null),
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
    const availableAccounts = accountRows.filter((account) => account.archivedAt === null);
    setAccounts(accountRows);
    setCards(cardRows);
    setRules(ruleRows);
    setTransactions(transactionRows);
    setAdjustmentAccountId((current) =>
      availableAccounts.some((account) => account.id === current) ? current : availableAccounts[0]?.id ?? ''
    );
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setTimeout(() => {
        reload().catch((error: Error) => {
          if (!active) return;
          setMessage(error.message);
          setLoading(false);
        });
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [reload])
  );

  async function createBudgetAccount() {
    const name = accountName.trim();
    const monthlyBudget = parseInteger(accountBudget || '0');
    if (!name) {
      setMessage('予算名を入力してください');
      return;
    }
    if (monthlyBudget === null || monthlyBudget < 0) {
      setMessage('毎月の予算は0円以上の整数で入力してください');
      return;
    }

    try {
      await createBudgetWithMonthlyRule(db, {
        name,
        monthlyBudget,
        sortOrder: accounts.length,
      });
      setAccountName('');
      setAccountBudget('');
      setMessage(monthlyBudget > 0 ? '予算と毎月の自動充当を追加しました' : '予算を追加しました');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '予算を追加できませんでした');
    }
  }

  async function archiveAccount(account: Account) {
    if (!canArchiveAccount(account.id, transactions)) {
      setMessage('残額が0円の予算だけ終了できます');
      return;
    }
    try {
      const linkedRules = rules.filter(
        (rule) => rule.fromAccountId === account.id || rule.toAccountId === account.id
      );
      await archiveBudgetAndRules(db, account.id, today());
      setMessage(
        linkedRules.length > 0 ? '予算と毎月の自動充当を終了しました' : '予算を終了しました'
      );
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '予算を終了できませんでした');
    }
  }

  async function reopenAccount(account: Account) {
    try {
      await reopenBudget(db, account.id);
      setEditingBudgetId((current) => (current === account.id ? null : current));
      setMessage('予算を再開しました。毎月の自動充当は0円です。必要なら「編集」から設定してください');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '予算を再開できませんでした');
    }
  }

  async function createCard() {
    const name = cardName.trim();
    const debitDay = parseDay(cardDebitDay);
    const closingDay = cardClosingDay.trim() ? parseDay(cardClosingDay) : null;
    if (!name) {
      setMessage('カード名を入力してください');
      return;
    }
    if (debitDay === null) {
      setMessage('引き落とし日は1〜31で入力してください');
      return;
    }
    if (cardClosingDay.trim() && closingDay === null) {
      setMessage('締め日は1〜31で入力してください');
      return;
    }

    try {
      await createCardWithSettlementAccount(db, {
        name,
        closingDay,
        debitDay,
        sortOrder: accounts.length,
      });
      setCardName('');
      setCardClosingDay('');
      setCardDebitDay('27');
      setMessage('カードを追加しました');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'カードを追加できませんでした');
    }
  }

  function beginCardEdit(card: Card) {
    setEditingCardId(card.id);
    setEditingCardName(card.name);
    setEditingCardClosingDay(card.closingDay === null ? '' : String(card.closingDay));
    setEditingCardDebitDay(String(card.debitDay));
    setMessage('');
  }

  async function saveCardEdit() {
    if (!editingCardId) return;
    const name = editingCardName.trim();
    const debitDay = parseDay(editingCardDebitDay);
    const closingDay = editingCardClosingDay.trim() ? parseDay(editingCardClosingDay) : null;
    if (!name || debitDay === null || (editingCardClosingDay.trim() && closingDay === null)) {
      setMessage('カード名と1〜31の締め日・引き落とし日を入力してください');
      return;
    }
    try {
      await updateCardSettings(db, editingCardId, { name, closingDay, debitDay });
      setEditingCardId(null);
      setMessage('カードを更新しました');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'カードを更新できませんでした');
    }
  }

  function beginBudgetEdit(account: Account) {
    setEditingBudgetId(account.id);
    setEditingBudgetName(account.name);
    setEditingBudgetAmount(String(account.monthlyBudget));
    setMessage('');
  }

  async function saveBudgetEdit() {
    if (!editingBudgetId) return;
    const name = editingBudgetName.trim();
    const monthlyBudget = parseInteger(editingBudgetAmount);
    if (!name || monthlyBudget === null || monthlyBudget < 0) {
      setMessage('予算名と0円以上の毎月予算を入力してください');
      return;
    }
    try {
      await updateBudgetAndMonthlyRule(db, editingBudgetId, { name, monthlyBudget });
      setEditingBudgetId(null);
      setMessage('予算を更新しました');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '予算を更新できませんでした');
    }
  }

  async function addBalanceAdjustment() {
    const amount = parseInteger(adjustmentAmount);
    if (!adjustmentAccountId) {
      setMessage('残高を合わせる対象を選んでください');
      return;
    }
    if (amount === null || amount === 0) {
      setMessage('増やす金額、またはマイナスの減額を整数で入力してください');
      return;
    }
    try {
      await insertTransaction(
        db,
        buildInitialBalanceAdjustment({ accountId: adjustmentAccountId, amount, date: today() })
      );
      setAdjustmentAmount('');
      setMessage('残高を更新しました');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '残高を更新できませんでした');
    }
  }

  async function exportJson() {
    try {
      const data = await exportData(db);
      const json = JSON.stringify(data, null, 2);
      setBackupJson(json);
      await Share.share({ message: json, title: 'kakeibo バックアップ' });
      setMessage('バックアップを作成しました');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'バックアップを作成できませんでした');
    }
  }

  async function importJson() {
    try {
      await importData(db, JSON.parse(backupJson));
      setMessage('バックアップから復元しました');
      await reload();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'バックアップを読み取れませんでした';
      Alert.alert('復元できませんでした', errorMessage);
      setMessage(errorMessage);
    }
  }

  function toggleSection(section: SettingsSection) {
    setOpenSection((current) => (current === section ? null : section));
    setMessage('');
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.pageHeader}>
            <ThemedText type="title">設定</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              必要な項目だけ開いて変更できます
            </ThemedText>
          </View>
          {loading ? <ActivityIndicator /> : null}
          {message ? (
            <ThemedView type="backgroundElement" style={styles.message}>
              <ThemedText type="small">{message}</ThemedText>
            </ThemedView>
          ) : null}

          <CollapsibleSection
            title="予算"
            summary={`${budgetAccounts.length}件`}
            open={openSection === 'budgets'}
            onPress={() => toggleSection('budgets')}>
            <ThemedText type="small" themeColor="textSecondary">
              使い道ごとの封筒と、毎月入れる金額を設定します。
            </ThemedText>
            <TextInput style={styles.input} value={accountName} onChangeText={setAccountName} placeholder="予算名（食費など）" />
            <TextInput
              keyboardType="number-pad"
              style={styles.input}
              value={accountBudget}
              onChangeText={setAccountBudget}
              placeholder="毎月の予算（0円でも可）"
            />
            <Button title="予算を追加" onPress={createBudgetAccount} />

            <View style={styles.list}>
              {accounts
                .filter((account) => account.type === 'budget')
                .map((account) => (
                  <View key={account.id} style={styles.row}>
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold">{account.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        毎月 {yen(account.monthlyBudget)}
                        {account.archivedAt ? `・終了済み（${account.archivedAt}）` : ''}
                      </ThemedText>
                    </View>
                    {!account.archivedAt ? (
                      <View style={styles.rowActions}>
                        <Button title="編集" onPress={() => beginBudgetEdit(account)} />
                        <Button title="終了" onPress={() => archiveAccount(account)} />
                      </View>
                    ) : (
                      <View style={styles.rowActions}>
                        <Button title="再開" onPress={() => reopenAccount(account)} />
                      </View>
                    )}
                  </View>
                ))}
            </View>

            {editingBudgetId ? (
            <View style={styles.subsection}>
              <ThemedText type="smallBold">予算を編集</ThemedText>
              <TextInput
                style={styles.input}
                value={editingBudgetName}
                onChangeText={setEditingBudgetName}
                placeholder="予算名"
              />
              <TextInput
                keyboardType="number-pad"
                style={styles.input}
                value={editingBudgetAmount}
                onChangeText={setEditingBudgetAmount}
                placeholder="毎月の予算"
              />
              <View style={styles.rowActions}>
                <Button title="保存" onPress={saveBudgetEdit} />
                <Button title="キャンセル" onPress={() => setEditingBudgetId(null)} />
              </View>
            </View>
            ) : null}
          </CollapsibleSection>

          <CollapsibleSection
            title="クレジットカード"
            summary={`${cards.length}枚`}
            open={openSection === 'cards'}
            onPress={() => toggleSection('cards')}>
            <ThemedText type="small" themeColor="textSecondary">
              カード利用時に、選んだ予算から支払い準備へ自動で取り分けます。
            </ThemedText>
            <TextInput style={styles.input} value={cardName} onChangeText={setCardName} placeholder="カード名" />
            <View style={styles.inlineInputs}>
              <TextInput
                keyboardType="number-pad"
                style={[styles.input, styles.inlineInput]}
                value={cardClosingDay}
                onChangeText={setCardClosingDay}
                placeholder="締め日（任意）"
              />
              <TextInput
                keyboardType="number-pad"
                style={[styles.input, styles.inlineInput]}
                value={cardDebitDay}
                onChangeText={setCardDebitDay}
                placeholder="引落日"
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">31は月末として扱います。</ThemedText>
            <Button title="カードを追加" onPress={createCard} />
            <View style={styles.list}>
              {cards.map((card) => (
                <View key={card.id} style={styles.cardItem}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold">{card.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        締め {dayLabel(card.closingDay)}・引き落とし {dayLabel(card.debitDay)}
                      </ThemedText>
                    </View>
                    <Button title="編集" onPress={() => beginCardEdit(card)} />
                  </View>
                </View>
              ))}
            </View>
            {editingCardId ? (
              <View style={styles.subsection}>
                <ThemedText type="smallBold">カードを編集</ThemedText>
                <TextInput style={styles.input} value={editingCardName} onChangeText={setEditingCardName} placeholder="カード名" />
                <View style={styles.inlineInputs}>
                  <TextInput
                    keyboardType="number-pad"
                    style={[styles.input, styles.inlineInput]}
                    value={editingCardClosingDay}
                    onChangeText={setEditingCardClosingDay}
                    placeholder="締め日"
                  />
                  <TextInput
                    keyboardType="number-pad"
                    style={[styles.input, styles.inlineInput]}
                    value={editingCardDebitDay}
                    onChangeText={setEditingCardDebitDay}
                    placeholder="引落日"
                  />
                </View>
                <View style={styles.rowActions}>
                  <Button title="保存" onPress={saveCardEdit} />
                  <Button title="キャンセル" onPress={() => setEditingCardId(null)} />
                </View>
              </View>
            ) : null}
          </CollapsibleSection>

          <CollapsibleSection
            title="残高を合わせる"
            summary="開始時・ずれの修正"
            open={openSection === 'balances'}
            onPress={() => toggleSection('balances')}>
            <ThemedText type="small" themeColor="textSecondary">
              利用開始時の残高や、実際の金額との差を入力します。減らす場合は先頭に − を付けます。
            </ThemedText>
            <View style={styles.choices}>
              {activeAccounts.map((account) => (
                <ChoiceButton
                  key={account.id}
                  label={displayAccountName(account, cards)}
                  selected={adjustmentAccountId === account.id}
                  onPress={() => setAdjustmentAccountId(account.id)}
                />
              ))}
            </View>
            <TextInput
              keyboardType="numbers-and-punctuation"
              style={styles.input}
              value={adjustmentAmount}
              onChangeText={setAdjustmentAmount}
              placeholder="増減額（例: 3000 / -500）"
            />
            <Button title="残高を更新" onPress={addBalanceAdjustment} />
          </CollapsibleSection>

          <CollapsibleSection
            title="バックアップ"
            summary="保存・復元"
            open={openSection === 'backup'}
            onPress={() => toggleSection('backup')}>
            <ThemedText type="small" themeColor="textSecondary">
              作成したデータを安全な場所へ保管し、機種変更時などに貼り付けて復元できます。
            </ThemedText>
            <Button title="バックアップを作成" onPress={exportJson} />
            <TextInput
              multiline
              numberOfLines={8}
              style={[styles.input, styles.jsonInput]}
              value={backupJson}
              onChangeText={setBackupJson}
              placeholder="バックアップデータをここに貼り付け"
            />
            <Button title="バックアップから復元" onPress={importJson} />
          </CollapsibleSection>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function CollapsibleSection({
  title,
  summary,
  open,
  onPress,
  children,
}: PropsWithChildren<{ title: string; summary: string; open: boolean; onPress: () => void }>) {
  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={styles.panelHeader}>
        <View style={styles.panelTitle}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{summary}</ThemedText>
        </View>
        <ThemedText type="subtitle">{open ? '−' : '＋'}</ThemedText>
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </ThemedView>
  );
}

function ChoiceButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: { gap: 12, padding: 20, paddingBottom: 48 },
  pageHeader: { gap: 4, marginBottom: 4 },
  message: { borderRadius: 8, padding: 12 },
  panel: { borderRadius: 12, overflow: 'hidden' },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  panelTitle: { gap: 2 },
  sectionBody: { borderTopColor: '#d1d5db', borderTopWidth: StyleSheet.hairlineWidth, gap: 12, padding: 16 },
  subsection: { borderTopColor: '#d1d5db', borderTopWidth: StyleSheet.hairlineWidth, gap: 10, marginTop: 4, paddingTop: 16 },
  input: { backgroundColor: '#ffffff', borderColor: '#9ca3af', borderRadius: 8, borderWidth: 1, color: '#111827', paddingHorizontal: 12, paddingVertical: 10 },
  inlineInputs: { flexDirection: 'row', gap: 10 },
  inlineInput: { flex: 1 },
  list: { gap: 10, marginTop: 4 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  rowText: { flex: 1, gap: 2 },
  rowActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  cardItem: { borderColor: '#d1d5db', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 3, padding: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { backgroundColor: '#ffffff', borderColor: '#9ca3af', borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  choiceSelected: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
  jsonInput: { minHeight: 160, textAlignVertical: 'top' },
});
