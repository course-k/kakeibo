import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";
import type { Account, Card, Transaction } from "@/domain/types";
import { deriveBalance } from "@/domain/balance";
import { useDb } from "@/db/provider";
import { normalizeIsoDate } from "@/db/normalize-date";
import { listAccounts } from "@/db/accounts-repository";
import { listCards } from "@/db/cards-repository";
import {
  getTransactionById,
  insertTransaction,
  listTransactions,
  softDeleteTransaction,
  updateTransaction,
} from "@/db/transactions-repository";
import {
  appendAmountDigit,
  buildExpenseTransactionInput,
  buildExpenseTransactionPatch,
  clearAmount,
  createEditingInputState,
  createInitialInputState,
  deleteAmountDigit,
  deriveLastInputDefaults,
  selectInputBudgetAccounts,
  todayIsoDate,
  type InputFormState,
  type PaymentSelection,
} from "@/features/input/input-logic";

const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

export default function InputScreen() {
  const db = useDb();
  const router = useRouter();
  const params = useLocalSearchParams<{ transactionId?: string }>();
  const editingId = typeof params.transactionId === "string" ? params.transactionId : null;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [state, setState] = useState<InputFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetAccounts = useMemo(
    () => selectInputBudgetAccounts(accounts, editingTransaction?.fromAccountId ?? null),
    [accounts, editingTransaction]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedAccounts, loadedCards, loadedTransactions] = await Promise.all([
        listAccounts(db, { includeArchived: true }),
        listCards(db),
        listTransactions(db),
      ]);
      const activeBudgets = loadedAccounts.filter(
        (account) => account.type === "budget" && account.archivedAt === null
      );
      const target = editingId ? await getTransactionById(db, editingId) : undefined;
      const inputBudgets = selectInputBudgetAccounts(
        loadedAccounts,
        target?.fromAccountId ?? null
      );
      const defaults = deriveLastInputDefaults(loadedTransactions, loadedCards);
      const defaultBudgetAccountId = activeBudgets.some(
        (account) => account.id === defaults.budgetAccountId
      )
        ? defaults.budgetAccountId
        : activeBudgets[0]?.id ?? null;
      const nextState = target
        ? createEditingInputState(target, loadedCards, loadedAccounts)
        : createInitialInputState(
            {
              budgetAccountId: defaultBudgetAccountId,
              payment: normalizePayment(defaults.payment, loadedCards),
            },
            todayIsoDate()
          );

      setAccounts(loadedAccounts);
      setCards(loadedCards);
      setEditingTransaction(target ?? null);
      setBalances(
        Object.fromEntries(
          inputBudgets.map((account) => [
            account.id,
            deriveBalance(account.id, loadedTransactions, todayIsoDate()),
          ])
        )
      );
      setState(nextState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "入力画面の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [db, editingId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const updateState = (patch: Partial<InputFormState>) => {
    setState((current) => (current ? { ...current, ...patch } : current));
  };

  const handleKey = (key: string) => {
    setState((current) => {
      if (!current) return current;
      if (key === "C") return { ...current, amountText: clearAmount() };
      if (key === "⌫") return { ...current, amountText: deleteAmountDigit(current.amountText) };
      return { ...current, amountText: appendAmountDigit(current.amountText, key) };
    });
  };

  const handleSave = async () => {
    if (!state || saving) return;
    setSaving(true);
    setError(null);
    try {
      const normalizedDate = normalizeIsoDate(state.date);
      if (normalizedDate > todayIsoDate()) {
        throw new Error("未来の日付は記録できません");
      }
      const normalizedState = { ...state, date: normalizedDate };
      if (editingId) {
        await updateTransaction(db, editingId, buildExpenseTransactionPatch(normalizedState, cards));
      } else {
        await insertTransaction(db, buildExpenseTransactionInput(normalizedState, cards));
      }
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId || saving) return;
    Alert.alert("削除しますか", "この取引を削除します。", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setSaving(true);
            setError(null);
            try {
              await softDeleteTransaction(db, editingId);
              router.back();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "削除に失敗しました");
            } finally {
              setSaving(false);
            }
          })();
        },
      },
    ]);
  };

  const selectedBudget = budgetAccounts.find((account) => account.id === state?.budgetAccountId);
  const amount = state ? Number(state.amountText || 0) : 0;
  const restoredOriginalAmount =
    selectedBudget && editingTransaction?.fromAccountId === selectedBudget.id
      ? editingTransaction.amount
      : 0;
  const remainingAfterSave = selectedBudget
    ? (balances[selectedBudget.id] ?? 0) + restoredOriginalAmount - amount
    : null;
  const payment = state?.payment;
  const selectedCard =
    payment?.kind === "card" ? cards.find((card) => card.id === payment.cardId) : undefined;
  const archivedEditingBudget = editingTransaction
    ? accounts.find(
        (account) =>
          account.id === editingTransaction.fromAccountId &&
          account.type === "budget" &&
          account.archivedAt !== null
      )
    : undefined;

  if (loading) {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.center}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!state) {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.center}>
          <View style={styles.loadError}>
            <ThemedText type="subtitle">入力画面を開けません</ThemedText>
            <ThemedText themeColor="textSecondary">{error ?? 'データを読み込めませんでした'}</ThemedText>
            <Pressable style={styles.saveButton} onPress={() => void load()}>
              <ThemedText style={styles.saveButtonText}>もう一度試す</ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="subtitle">{editingId ? "支出を編集" : "支出を入力"}</ThemedText>
            <TextInput
              value={state.date}
              onChangeText={(date) => updateState({ date })}
              style={styles.dateInput}
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
            />
          </View>

          <View style={styles.amountBox}>
            <ThemedText type="small" themeColor="textSecondary">
              金額
            </ThemedText>
            <ThemedText type="title">{state.amountText || "0"} 円</ThemedText>
          </View>

          <View style={styles.keypad}>
            {keypad.map((key) => (
              <Pressable key={key} style={styles.key} onPress={() => handleKey(key)}>
                <ThemedText type="subtitle">{key}</ThemedText>
              </Pressable>
            ))}
          </View>

          <SectionTitle title="どの予算から使う？" />
          {budgetAccounts.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText>先に予算を1つ作成してください</ThemedText>
              <Pressable style={styles.secondaryButton} onPress={() => router.replace('/(tabs)/settings')}>
                <ThemedText type="smallBold">設定を開く</ThemedText>
              </Pressable>
            </View>
          ) : (
          <View style={styles.choices}>
            {budgetAccounts.map((account) => (
              <ChoiceButton
                key={account.id}
                label={`${account.name}${account.archivedAt ? "（終了済み）" : ""}  ${formatYen(balances[account.id] ?? 0)}`}
                selected={state.budgetAccountId === account.id}
                onPress={() => updateState({ budgetAccountId: account.id })}
              />
            ))}
          </View>
          )}

          <SectionTitle title="支払手段" />
          <View style={styles.choices}>
            <ChoiceButton
              label="現金・即時払い"
              selected={state.payment.kind === "cash"}
              onPress={() => updateState({ payment: { kind: "cash" } })}
            />
            {cards.map((card) => (
              <ChoiceButton
                key={card.id}
                label={card.name}
                selected={state.payment.kind === "card" && state.payment.cardId === card.id}
                onPress={() => updateState({ payment: { kind: "card", cardId: card.id } })}
              />
            ))}
          </View>

          {selectedBudget && amount > 0 ? (
            <View style={[styles.preview, remainingAfterSave !== null && remainingAfterSave < 0 && styles.previewWarning]}>
              <ThemedText type="smallBold">保存すると</ThemedText>
              <ThemedText>
                {selectedBudget.name} {formatYen(balances[selectedBudget.id] ?? 0)} → {formatYen(remainingAfterSave ?? 0)}
              </ThemedText>
              {selectedCard ? (
                <ThemedText type="small" themeColor="textSecondary">
                  同額を「{selectedCard.name} の支払準備」に自動で取り分けます
                </ThemedText>
              ) : null}
              {remainingAfterSave !== null && remainingAfterSave < 0 ? (
                <ThemedText style={styles.warningText}>予算を超えます。保存後に別の予算から移してください。</ThemedText>
              ) : null}
            </View>
          ) : null}

          <TextInput
            value={state.memo}
            onChangeText={(memo) => updateState({ memo })}
            style={styles.dateInput}
            placeholder="店名・メモ（任意）"
            returnKeyType="done"
          />

          {archivedEditingBudget ? (
            <View style={styles.previewWarning}>
              <ThemedText type="smallBold">「{archivedEditingBudget.name}」は終了済みです</ThemedText>
              <ThemedText type="small">
                過去の残高を隠さないため、金額の変更や削除の前に予算を再開してください。
              </ThemedText>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => router.push('/(tabs)/settings')}>
                <ThemedText type="smallBold">設定で予算を再開</ThemedText>
              </Pressable>
            </View>
          ) : null}

          {error ? <ThemedText themeColor="textSecondary">{error}</ThemedText> : null}

        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            style={styles.saveButton}
            onPress={handleSave}
            disabled={saving || budgetAccounts.length === 0 || Boolean(archivedEditingBudget)}>
            <ThemedText style={styles.saveButtonText}>{saving ? "保存中" : "保存"}</ThemedText>
          </Pressable>
          {editingId ? (
            <Pressable
              style={styles.deleteButton}
              onPress={handleDelete}
              disabled={saving || Boolean(archivedEditingBudget)}>
              <ThemedText style={styles.deleteButtonText}>削除</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function normalizePayment(payment: PaymentSelection, cards: Card[]): PaymentSelection {
  if (payment.kind === "card" && cards.some((card) => card.id === payment.cardId)) {
    return payment;
  }
  return { kind: "cash" };
}

function SectionTitle({ title }: { title: string }) {
  return <ThemedText type="smallBold">{title}</ThemedText>;
}

function formatYen(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}¥${Math.abs(amount).toLocaleString('ja-JP')}`;
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
    <Pressable style={[styles.choice, selected && styles.choiceSelected]} onPress={onPress}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadError: {
    gap: Spacing.three,
    maxWidth: 360,
    padding: Spacing.three,
    width: '100%',
  },
  content: {
    gap: Spacing.three,
    padding: Spacing.three,
    paddingBottom: Spacing.four,
  },
  footer: {
    backgroundColor: Colors.light.background,
    borderTopColor: Colors.light.backgroundSelected,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  header: {
    gap: Spacing.two,
  },
  dateInput: {
    borderRadius: 8,
    backgroundColor: Colors.light.backgroundElement,
    fontSize: 16,
    padding: Spacing.three,
  },
  amountBox: {
    gap: Spacing.one,
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  key: {
    width: "31.5%",
    aspectRatio: 1.8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: Colors.light.backgroundElement,
  },
  choices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  emptyState: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 8,
    backgroundColor: Colors.light.backgroundElement,
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: Colors.light.backgroundSelected,
    padding: Spacing.three,
  },
  preview: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: 8,
    backgroundColor: "#eff6ff",
  },
  previewWarning: {
    backgroundColor: "#fff7ed",
    borderRadius: 8,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  warningText: {
    color: "#c2410c",
  },
  choice: {
    borderRadius: 8,
    backgroundColor: Colors.light.backgroundElement,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  choiceSelected: {
    backgroundColor: Colors.light.backgroundSelected,
  },
  saveButton: {
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#111111",
    padding: Spacing.three,
  },
  saveButtonText: {
    color: "#ffffff",
  },
  deleteButton: {
    alignItems: "center",
    borderRadius: 8,
    borderColor: "#B42318",
    borderWidth: 1,
    padding: Spacing.three,
  },
  deleteButtonText: {
    color: "#B42318",
  },
});
