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
import { useDb } from "@/db/provider";
import { getCardById } from "@/db/cards-repository";
import { insertTransaction, listTransactions } from "@/db/transactions-repository";
import {
  deriveCardPreparedAmount,
  deriveCardPreparedChange,
  isCardPreparedTransaction,
  type Card,
  type Transaction,
} from "@/domain";
import { buildCardSettlementTransactions } from "@/features/cards/settlement";

type ScreenState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "ready"; card: Card; preparedAmount: number; transactions: Transaction[] }
  | { status: "error"; message: string };

function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function formatDay(day: number): string {
  return day === 31 ? "月末" : `${day}日`;
}

function todayIsoDate(): string {
  const now = new Date();
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseAmount(text: string): number | null {
  if (!/^[1-9]\d*$/.test(text.trim())) return null;
  const amount = Number(text);
  return Number.isSafeInteger(amount) ? amount : null;
}

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [paidAmountText, setPaidAmountText] = useState("");
  const [saving, setSaving] = useState(false);
  const cardId = Array.isArray(id) ? id[0] : id;

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!cardId) {
      setState({ status: "notFound" });
      return;
    }

    try {
      const [card, transactions] = await Promise.all([
        getCardById(db, cardId),
        listTransactions(db),
      ]);
      if (!card) {
        setState({ status: "notFound" });
        return;
      }
      const preparedAmount = deriveCardPreparedAmount(card, transactions, todayIsoDate());
      setState({
        status: "ready",
        card,
        preparedAmount,
        transactions: transactions
          .filter((transaction) => isCardPreparedTransaction(card, transaction))
          .reverse(),
      });
      setPaidAmountText("");
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [cardId, db]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timeout = setTimeout(() => {
        if (!active) return;
      void load();
      }, 0);
      return () => {
        active = false;
        clearTimeout(timeout);
      };
    }, [load])
  );

  const paidAmount = useMemo(() => parseAmount(paidAmountText), [paidAmountText]);
  const canSave = state.status === "ready" && paidAmount !== null && !saving;

  const handleSettle = useCallback(async () => {
    if (state.status !== "ready" || paidAmount === null) return;

    setSaving(true);
    try {
      const built = buildCardSettlementTransactions({
        card: state.card,
        paidAmount,
        date: todayIsoDate(),
      });
      await insertTransaction(db, built);
      await load();
    } catch (error) {
      Alert.alert("消し込みに失敗しました", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [db, load, paidAmount, state]);

  const confirmSettle = useCallback(() => {
    if (state.status !== "ready" || paidAmount === null) return;
    Alert.alert(
      "カード引き落としを記録",
      `${state.card.name} の引き落とし ${formatYen(paidAmount)} を記録します。`,
      [
        { text: "キャンセル", style: "cancel" },
        { text: "記録する", onPress: () => void handleSettle() },
      ]
    );
  }, [handleSettle, paidAmount, state]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {state.status === "loading" ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : null}

          {state.status === "notFound" ? (
            <View style={styles.center}>
              <ThemedText type="title">カードが見つかりません</ThemedText>
            </View>
          ) : null}

          {state.status === "error" ? (
            <View style={styles.center}>
              <ThemedText type="title">読み込みに失敗しました</ThemedText>
              <ThemedText>{state.message}</ThemedText>
            </View>
          ) : null}

          {state.status === "ready" ? (
            <>
              <View style={styles.header}>
                <ThemedText type="title">{state.card.name}</ThemedText>
                <ThemedText>引き落とし日: {formatDay(state.card.debitDay)}</ThemedText>
              </View>

              <View style={styles.summary}>
                <View style={styles.row}>
                  <ThemedText>支払準備総額</ThemedText>
                  <ThemedText type="smallBold" style={styles.amountText}>
                    {formatYen(state.preparedAmount)}
                  </ThemedText>
                </View>
              </View>

              {state.preparedAmount < 0 ? (
                <ThemedText style={styles.warning}>
                  支払準備総額が負です。過払いまたは取引不整合の可能性があります。
                </ThemedText>
              ) : null}

              <View style={styles.settlement}>
                <ThemedText type="smallBold">実際の引き落とし額</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  カード会社の明細を確認して、実際の金額を入力してください。支払準備総額は請求額の推定ではありません。
                </ThemedText>
                <TextInput
                  value={paidAmountText}
                  onChangeText={setPaidAmountText}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  style={styles.input}
                  placeholder="明細の引き落とし額"
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!canSave}
                  onPress={confirmSettle}
                  style={[styles.button, !canSave ? styles.buttonDisabled : null]}
                >
                  <ThemedText style={styles.buttonText}>
                    {saving ? "記録中" : "引き落としを記録"}
                  </ThemedText>
                </Pressable>
              </View>

              <View style={styles.history}>
                <ThemedText type="subtitle">このカードの履歴</ThemedText>
                {state.transactions.length === 0 ? <ThemedText>まだ記録がありません</ThemedText> : null}
                {state.transactions.slice(0, 20).map((transaction) => (
                  <Pressable
                    key={transaction.id}
                    onPress={() =>
                      transaction.type === 'expense_card'
                        ? router.push({ pathname: '/input', params: { transactionId: transaction.id } })
                        : router.push(`/transaction/${transaction.id}`)
                    }
                    style={styles.historyRow}>
                    <View style={styles.historyText}>
                      <ThemedText>{transaction.memo || (transaction.type === 'card_debit' ? 'カード引き落とし' : 'カード利用')}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{transaction.date}</ThemedText>
                    </View>
                    <ThemedText>{formatYen(deriveCardPreparedChange(state.card, transaction))}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 20,
    gap: 20,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  header: {
    gap: 8,
  },
  summary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8E8E93",
    borderRadius: 8,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  warning: {
    color: "#C2410C",
  },
  amountText: {
    textAlign: "right",
  },
  settlement: {
    gap: 12,
  },
  history: { gap: 10 },
  historyRow: {
    alignItems: 'center',
    borderBottomColor: '#d1d5db',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: 8,
  },
  historyText: { flex: 1, gap: 2 },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8E8E93",
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 18,
    backgroundColor: "#FFFFFF",
  },
  button: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
