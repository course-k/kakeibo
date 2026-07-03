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
import type { Account, Card } from "@/domain/types";
import { useDb } from "@/db/provider";
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
  createInitialInputState,
  deleteAmountDigit,
  deriveLastInputDefaults,
  inputStateFromTransaction,
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
  const [state, setState] = useState<InputFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetAccounts = useMemo(
    () => accounts.filter((account) => account.type === "budget" && account.archivedAt === null),
    [accounts]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedAccounts, loadedCards, loadedTransactions] = await Promise.all([
        listAccounts(db, { includeArchived: false }),
        listCards(db),
        listTransactions(db),
      ]);
      const activeBudgets = loadedAccounts.filter((account) => account.type === "budget");
      const target = editingId ? await getTransactionById(db, editingId) : undefined;
      const defaults = deriveLastInputDefaults(loadedTransactions, loadedCards);
      const nextState = target
        ? inputStateFromTransaction(target, loadedCards)
        : createInitialInputState(
            {
              budgetAccountId: defaults.budgetAccountId ?? activeBudgets[0]?.id ?? null,
              payment: normalizePayment(defaults.payment, loadedCards),
            },
            todayIsoDate()
          );

      setAccounts(loadedAccounts);
      setCards(loadedCards);
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
      if (editingId) {
        await updateTransaction(db, editingId, buildExpenseTransactionPatch(state, cards));
      } else {
        await insertTransaction(db, buildExpenseTransactionInput(state, cards));
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

  if (loading || !state) {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.center}>
          <ActivityIndicator />
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

          <SectionTitle title="予算口座" />
          <View style={styles.choices}>
            {budgetAccounts.map((account) => (
              <ChoiceButton
                key={account.id}
                label={account.name}
                selected={state.budgetAccountId === account.id}
                onPress={() => updateState({ budgetAccountId: account.id })}
              />
            ))}
          </View>

          <SectionTitle title="支払手段" />
          <View style={styles.choices}>
            <ChoiceButton
              label="現金"
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

          {error ? <ThemedText themeColor="textSecondary">{error}</ThemedText> : null}

          <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
            <ThemedText style={styles.saveButtonText}>{saving ? "保存中" : "保存"}</ThemedText>
          </Pressable>

          {editingId ? (
            <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={saving}>
              <ThemedText style={styles.deleteButtonText}>削除</ThemedText>
            </Pressable>
          ) : null}
        </ScrollView>
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
  content: {
    gap: Spacing.three,
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
