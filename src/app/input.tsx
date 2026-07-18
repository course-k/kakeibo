import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { Spacing } from "@/constants/theme";
import { listAccounts } from "@/db/accounts-repository";
import { listCards } from "@/db/cards-repository";
import { listCategories } from "@/db/categories-repository";
import { normalizeIsoDate } from "@/db/normalize-date";
import { useDb } from "@/db/provider";
import {
  getRecurringRuleById,
  insertRecurringRule,
  updateRecurringRule,
} from "@/db/recurring-rules-repository";
import {
  getTransactionById,
  insertTransaction,
  listTransactions,
  softDeleteTransaction,
  updateTransaction,
} from "@/db/transactions-repository";
import { deriveBalance } from "@/domain/balance";
import type { Account, Card, Category, RecurringRule, Transaction } from "@/domain/types";
import {
  buildEntryRecurringRuleInput,
  buildEntryTransactionInput,
  buildEntryTransactionPatch,
  changeEntryKind,
  createEntryState,
  entryStateFromRecurringRule,
  entryStateFromTransaction,
  type EntryFormState,
  type EntryKind,
} from "@/features/input/entry-logic";
import { todayIsoDate } from "@/features/input/input-logic";

const kindLabels: Record<EntryKind, string> = {
  expense: "支出",
  income: "収入",
  transfer: "振替",
};

export default function InputScreen() {
  const db = useDb();
  const router = useRouter();
  const params = useLocalSearchParams<{
    transactionId?: string;
    recurringRuleId?: string;
    kind?: string;
    recurring?: string;
  }>();
  const transactionId = singleParam(params.transactionId);
  const recurringRuleId = singleParam(params.recurringRuleId);
  const requestedRecurring = singleParam(params.recurring) === "1";
  const requestedKind = isEntryKind(singleParam(params.kind)) ? (singleParam(params.kind) as EntryKind) : "expense";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [state, setState] = useState<EntryFormState | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState("");
  const saveLock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [loadedAccounts, loadedCards, loadedCategories, transactions] = await Promise.all([
        listAccounts(db, { includeArchived: true }),
        listCards(db),
        listCategories(db, { includeArchived: true }),
        listTransactions(db),
      ]);
      const transaction = transactionId ? await getTransactionById(db, transactionId) : undefined;
      const rule = recurringRuleId ? await getRecurringRuleById(db, recurringRuleId) : undefined;
      if (transactionId && !transaction) throw new Error("編集する記録が見つかりません");
      if (recurringRuleId && !rule) throw new Error("編集する定期記録が見つかりません");
      if (rule?.ruleKind === "budget_allocation") {
        throw new Error("月初の予算充当は設定の予算編集から変更してください");
      }
      let next = transaction
        ? entryStateFromTransaction(transaction)
        : rule
          ? entryStateFromRecurringRule(rule, todayIsoDate())
          : createEntryState(requestedKind, todayIsoDate());
      if (!transaction && !rule && requestedRecurring) next = { ...next, recurring: true };
      next = applyDefaults(next, loadedAccounts, loadedCategories);
      setAccounts(loadedAccounts);
      setCards(loadedCards);
      setCategories(loadedCategories);
      setEditingTransaction(transaction ?? null);
      setEditingRule(rule ?? null);
      setDetailsOpen(Boolean(transaction || rule || requestedRecurring));
      setBalances(
        Object.fromEntries(
          loadedAccounts.map((account) => [
            account.id,
            deriveBalance(account.id, transactions, todayIsoDate()),
          ]),
        ),
      );
      setState(next);
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error ? cause.message : "入力画面を開けませんでした");
    } finally {
      setLoading(false);
    }
  }, [db, recurringRuleId, requestedKind, requestedRecurring, transactionId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const activeBudgets = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.type === "budget" &&
          (account.archivedAt === null ||
            account.id === state?.fromAccountId ||
            account.id === state?.toAccountId),
      ),
    [accounts, state?.fromAccountId, state?.toAccountId],
  );
  const visibleCategories = useMemo(
    () =>
      categories.filter(
        (category) =>
          category.kind === (state?.kind === "income" ? "income" : "expense") &&
          (category.archivedAt === null || category.id === state?.categoryId),
      ),
    [categories, state?.categoryId, state?.kind],
  );

  function update(patch: Partial<EntryFormState>) {
    setState((current) => (current ? { ...current, ...patch } : current));
  }

  function selectKind(kind: EntryKind) {
    if (editingTransaction || editingRule) return;
    setState((current) =>
      current ? applyDefaults(changeEntryKind(current, kind), accounts, categories) : current,
    );
  }

  async function save() {
    if (!state || saving || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const date = isRule ? state.date : normalizeIsoDate(state.date);
      if (!isRule && date > todayIsoDate()) throw new Error("未来の日付は記録できません");
      const normalized = { ...state, date };
      if (editingRule) {
        await updateRecurringRule(db, editingRule.id, buildEntryRecurringRuleInput(normalized, cards));
      } else if (!editingTransaction && normalized.recurring) {
        await insertRecurringRule(db, buildEntryRecurringRuleInput(normalized, cards));
      } else if (editingTransaction) {
        await updateTransaction(
          db,
          editingTransaction.id,
          buildEntryTransactionPatch(normalized, cards, editingTransaction),
        );
      } else {
        await insertTransaction(db, buildEntryTransactionInput(normalized, cards));
      }
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存できませんでした");
      saveLock.current = false;
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!editingTransaction || saving) return;
    Alert.alert("この記録を削除しますか", "残高と集計から取り除かれます。", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await softDeleteTransaction(db, editingTransaction.id);
              router.back();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "削除できませんでした");
            }
          })();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.center} edges={["bottom"]}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!state) {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.center} edges={["bottom"]}>
          <ThemedText type="subtitle">入力画面を開けません</ThemedText>
          <ThemedText>{error}</ThemedText>
          <Pressable style={styles.primaryButton} onPress={() => void load()}>
            <ThemedText style={styles.primaryText}>もう一度試す</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isRule = Boolean(editingRule) || state.recurring;
  const hasArchivedSelection =
    activeBudgets.some(
      (account) =>
        (account.id === state.fromAccountId || account.id === state.toAccountId) &&
        account.archivedAt !== null,
    ) || visibleCategories.some((category) => category.id === state.categoryId && category.archivedAt !== null);
  const normalizedAmount = state.amountText.replace(/,/g, "").trim();
  const amount = Number(normalizedAmount);
  const validAmount = /^\d+$/.test(normalizedAmount) && Number.isSafeInteger(amount) && amount > 0;
  const hasRequiredSelection =
    state.kind === "income"
      ? Boolean(state.toAccountId && state.categoryId)
      : state.kind === "transfer"
        ? Boolean(state.fromAccountId && state.toAccountId && state.fromAccountId !== state.toAccountId)
        : Boolean(state.fromAccountId && state.categoryId);
  const canSave =
    !saving &&
    !hasArchivedSelection &&
    activeBudgets.length > 0 &&
    validAmount &&
    hasRequiredSelection;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <ScrollView style={styles.formScroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View accessibilityRole="tablist" style={styles.segmented}>
            {(Object.keys(kindLabels) as EntryKind[]).map((kind) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: state.kind === kind, disabled: Boolean(editingTransaction || editingRule) }}
                disabled={Boolean(editingTransaction || editingRule)}
                key={kind}
                onPress={() => selectKind(kind)}
                style={[styles.segment, state.kind === kind && styles.segmentSelected]}>
                <ThemedText type="smallBold">{kindLabels[kind]}</ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={styles.amountCard}>
            <ThemedText type="smallBold" themeColor="textSecondary">金額</ThemedText>
            <View style={styles.amountRow}>
              <TextInput
                accessibilityLabel="金額"
                autoFocus={!editingTransaction && !editingRule}
                inputMode="numeric"
                keyboardType="number-pad"
                onChangeText={(amountText) => update({ amountText })}
                placeholder="0"
                style={styles.amountInput}
                value={state.amountText}
              />
              <ThemedText style={styles.yenLabel}>円</ThemedText>
            </View>
          </View>

          {state.kind === "expense" ? (
            <ChoiceGroup
              accounts={activeBudgets}
              balances={balances}
              label="どの予算から使う？"
              onSelect={(fromAccountId) => update({ fromAccountId })}
              selectedId={state.fromAccountId}
            />
          ) : null}
          {state.kind === "income" ? (
            <ChoiceGroup
              accounts={activeBudgets}
              balances={balances}
              label="どの予算に入れる？"
              onSelect={(toAccountId) => update({ toAccountId })}
              selectedId={state.toAccountId}
            />
          ) : null}
          {state.kind === "transfer" ? (
            <>
              <ChoiceGroup
                accounts={activeBudgets}
                balances={balances}
                label="移動元"
                onSelect={(fromAccountId) =>
                  update({
                    fromAccountId,
                    toAccountId: state.toAccountId === fromAccountId ? null : state.toAccountId,
                  })
                }
                selectedId={state.fromAccountId}
              />
              <ChoiceGroup
                accounts={activeBudgets.filter((account) => account.id !== state.fromAccountId)}
                balances={balances}
                label="移動先"
                onSelect={(toAccountId) => update({ toAccountId })}
                selectedId={state.toAccountId}
              />
            </>
          ) : null}

          {state.kind !== "transfer" ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <FieldLabel>{state.kind === "income" ? "収入カテゴリ" : "支出カテゴリ"}</FieldLabel>
                <Pressable onPress={() => router.push("/(tabs)/settings")}>
                  <ThemedText type="smallBold">カテゴリ設定 ›</ThemedText>
                </Pressable>
              </View>
              <View style={styles.chips}>
                {visibleCategories.map((category) => (
                  <ChoiceChip
                    key={category.id}
                    label={`${category.name}${category.archivedAt ? "（無効）" : ""}`}
                    onPress={() => update({ categoryId: category.id })}
                    selected={state.categoryId === category.id}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {state.kind === "expense" ? (
            <View style={styles.sectionCard}>
              <FieldLabel>支払方法</FieldLabel>
              <View style={styles.chips}>
                <ChoiceChip
                  label="現金・即時払い"
                  onPress={() => update({ payment: { kind: "cash" } })}
                  selected={state.payment.kind === "cash"}
                />
                {cards.map((card) => (
                  <ChoiceChip
                    key={card.id}
                    label={card.name}
                    onPress={() => update({ payment: { kind: "card", cardId: card.id } })}
                    selected={state.payment.kind === "card" && state.payment.cardId === card.id}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((open) => !open)}
            style={styles.detailsDisclosure}>
            <View style={styles.detailsSummary}>
              <ThemedText type="smallBold">日付・メモ・繰り返し</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {isRule ? `毎月${state.dayOfMonth}日` : state.date}{state.memo ? " ・ メモあり" : ""}
              </ThemedText>
            </View>
            <ThemedText style={styles.disclosureIcon}>{detailsOpen ? "−" : "＋"}</ThemedText>
          </Pressable>

          {detailsOpen ? (
            <View style={styles.detailsCard}>
              {!isRule ? (
                <View style={styles.detailField}>
                  <FieldLabel>日付</FieldLabel>
                  <TextInput
                    accessibilityLabel="記録日"
                    autoCapitalize="none"
                    autoCorrect={false}
                    inputMode="text"
                    onChangeText={(date) => update({ date })}
                    placeholder="YYYY-MM-DD"
                    style={styles.input}
                    value={state.date}
                  />
                </View>
              ) : null}
              {!editingTransaction ? (
                <View style={styles.repeatPanel}>
                  {!editingRule && !requestedRecurring ? (
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: state.recurring }}
                      onPress={() => update({ recurring: !state.recurring })}
                      style={styles.repeatToggle}>
                      <View>
                        <ThemedText type="smallBold">毎月繰り返す</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">将来の月も自動で記録</ThemedText>
                      </View>
                      <View style={[styles.togglePill, state.recurring && styles.togglePillOn]}>
                        <ThemedText type="smallBold" style={state.recurring ? styles.toggleTextOn : undefined}>
                          {state.recurring ? "ON" : "OFF"}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ) : null}
                  {isRule ? (
                    <View style={styles.dayRow}>
                      <ThemedText>毎月</ThemedText>
                      <TextInput
                        accessibilityLabel="毎月の日付"
                        inputMode="numeric"
                        keyboardType="number-pad"
                        onChangeText={(dayOfMonth) => update({ dayOfMonth })}
                        style={styles.dayInput}
                        value={state.dayOfMonth}
                      />
                      <ThemedText>日（31は月末）</ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.detailField}>
                <FieldLabel>メモ</FieldLabel>
                <TextInput
                  accessibilityLabel="メモ"
                  onChangeText={(memo) => update({ memo })}
                  placeholder="内容・店名など（任意）"
                  returnKeyType="done"
                  style={styles.input}
                  value={state.memo}
                />
              </View>
            </View>
          ) : null}

          {hasArchivedSelection ? (
            <ThemedView type="backgroundElement" style={styles.warningPanel}>
              <ThemedText type="smallBold">無効な予算またはカテゴリが選択されています</ThemedText>
              <ThemedText type="small">設定で再開してから保存してください。</ThemedText>
            </ThemedView>
          ) : null}
          {error ? (
            <ThemedText accessibilityLiveRegion="polite" style={styles.warning}>
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={!canSave}
            onPress={() => void save()}
            style={[styles.primaryButton, !canSave && styles.disabled]}>
            <ThemedText style={styles.primaryText}>
              {saving ? "保存中…" : isRule ? "定期記録を保存" : `${kindLabels[state.kind]}を記録`}
            </ThemedText>
          </Pressable>
          {editingTransaction ? (
            <Pressable style={styles.deleteButton} onPress={confirmDelete} disabled={saving}>
              <ThemedText style={styles.deleteText}>削除</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function applyDefaults(
  state: EntryFormState,
  accounts: Account[],
  categories: Category[],
): EntryFormState {
  const budgets = accounts.filter((account) => account.type === "budget" && account.archivedAt === null);
  const categoryKind = state.kind === "income" ? "income" : "expense";
  const matchingCategories = categories.filter(
    (category) => category.kind === categoryKind && category.archivedAt === null,
  );
  if (state.kind === "income") {
    return {
      ...state,
      toAccountId: state.toAccountId ?? budgets[0]?.id ?? null,
      categoryId: state.categoryId ?? matchingCategories[0]?.id ?? null,
    };
  }
  if (state.kind === "transfer") {
    const fromAccountId = state.fromAccountId ?? budgets[0]?.id ?? null;
    return {
      ...state,
      fromAccountId,
      toAccountId:
        state.toAccountId && state.toAccountId !== fromAccountId
          ? state.toAccountId
          : budgets.find((account) => account.id !== fromAccountId)?.id ?? null,
      categoryId: null,
    };
  }
  return {
    ...state,
    fromAccountId: state.fromAccountId ?? budgets[0]?.id ?? null,
    categoryId: state.categoryId ?? matchingCategories[0]?.id ?? null,
  };
}

function ChoiceGroup({
  label,
  accounts,
  balances,
  selectedId,
  onSelect,
}: {
  label: string;
  accounts: Account[];
  balances: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.sectionCard}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.choices}>
        {accounts.map((account) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: account.id === selectedId }}
            key={account.id}
            onPress={() => onSelect(account.id)}
            style={[styles.accountChoice, account.id === selectedId && styles.choiceSelected]}>
            <ThemedText type="smallBold">{account.name}{account.archivedAt ? "（終了済み）" : ""}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{yen(balances[account.id] ?? 0)}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ChoiceChip({
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
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.choiceSelected]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <ThemedText type="smallBold">{children}</ThemedText>;
}

function singleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isEntryKind(value: string | undefined): value is EntryKind {
  return value === "expense" || value === "income" || value === "transfer";
}

function yen(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}¥${Math.abs(value).toLocaleString("ja-JP")}`;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#f6f7f9", flex: 1 },
  safe: { backgroundColor: "#f6f7f9", flex: 1 },
  center: { alignItems: "center", flex: 1, gap: Spacing.three, justifyContent: "center", padding: Spacing.four },
  formScroll: { flex: 1 },
  content: { gap: 12, padding: Spacing.three, paddingBottom: Spacing.four },
  segmented: { backgroundColor: "#e8ebef", borderRadius: 12, flexDirection: "row", padding: 4 },
  segment: { alignItems: "center", borderRadius: 9, flex: 1, minHeight: 44, justifyContent: "center" },
  segmentSelected: { backgroundColor: "#ffffff", borderColor: "#d7dce2", borderWidth: 1 },
  amountCard: { backgroundColor: "#ffffff", borderColor: "#e1e5ea", borderRadius: 16, borderWidth: 1, gap: 2, paddingHorizontal: 16, paddingTop: 12 },
  amountRow: { alignItems: "center", flexDirection: "row", gap: Spacing.two },
  amountInput: { backgroundColor: "#ffffff", flex: 1, fontSize: 38, fontWeight: "700", minHeight: 62, minWidth: 0, paddingHorizontal: 0, textAlign: "right" },
  yenLabel: { fontSize: 20, fontWeight: "700" },
  input: { backgroundColor: "#ffffff", borderColor: "#d1d5db", borderRadius: 10, borderWidth: 1, fontSize: 16, minHeight: 48, paddingHorizontal: 14 },
  section: { gap: Spacing.two },
  sectionCard: { backgroundColor: "#ffffff", borderColor: "#e1e5ea", borderRadius: 14, borderWidth: 1, gap: Spacing.two, padding: 14 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  choices: { gap: 6 },
  accountChoice: { alignItems: "center", backgroundColor: "#f5f6f8", borderColor: "transparent", borderRadius: 10, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 48, paddingHorizontal: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#f0f2f5", borderColor: "transparent", borderRadius: 999, borderWidth: 1, minHeight: 42, justifyContent: "center", paddingHorizontal: 16 },
  choiceSelected: { backgroundColor: "#dbeafe", borderColor: "#2563eb" },
  detailsDisclosure: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#e1e5ea", borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 64, paddingHorizontal: 14, paddingVertical: 10 },
  detailsSummary: { flex: 1, gap: 2 },
  disclosureIcon: { color: "#4b5563", fontSize: 24 },
  detailsCard: { backgroundColor: "#ffffff", borderColor: "#e1e5ea", borderRadius: 14, borderWidth: 1, gap: 14, padding: 14 },
  detailField: { gap: 6 },
  repeatPanel: { gap: Spacing.two },
  repeatToggle: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 48 },
  togglePill: { alignItems: "center", backgroundColor: "#e5e7eb", borderRadius: 999, justifyContent: "center", minHeight: 36, minWidth: 58, paddingHorizontal: 12 },
  togglePillOn: { backgroundColor: "#2563eb" },
  toggleTextOn: { color: "#ffffff" },
  dayRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  dayInput: { backgroundColor: "#f0f2f5", borderRadius: 8, fontSize: 18, minHeight: 44, textAlign: "center", width: 64 },
  warningPanel: { borderRadius: 10, gap: 6, padding: 12 },
  warning: { color: "#b42318" },
  footer: { backgroundColor: "#ffffff", borderTopColor: "#e1e5ea", borderTopWidth: 1, flexDirection: "row", flexShrink: 0, gap: 10, padding: 12 },
  primaryButton: { alignItems: "center", backgroundColor: "#2563eb", borderRadius: 12, flex: 1, minHeight: 52, justifyContent: "center", paddingHorizontal: 18 },
  primaryText: { color: "#ffffff", fontWeight: "700" },
  deleteButton: { alignItems: "center", borderColor: "#b42318", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 50, paddingHorizontal: 18 },
  deleteText: { color: "#b42318", fontWeight: "700" },
  disabled: { opacity: 0.45 },
});
