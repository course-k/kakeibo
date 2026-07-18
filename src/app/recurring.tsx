import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { listAccounts } from "@/db/accounts-repository";
import { listCards } from "@/db/cards-repository";
import { listCategories } from "@/db/categories-repository";
import { useDb } from "@/db/provider";
import { deleteRecurringRule, listRecurringRules } from "@/db/recurring-rules-repository";
import type { Account, Card, Category, RecurringRule } from "@/domain/types";

export default function RecurringScreen() {
  const db = useDb();
  const router = useRouter();
  const [rules, setRules] = useState<RecurringRule[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [loadedRules, loadedAccounts, loadedCards, loadedCategories] = await Promise.all([
        listRecurringRules(db),
        listAccounts(db, { includeArchived: true }),
        listCards(db),
        listCategories(db, { includeArchived: true }),
      ]);
      setRules(
        loadedRules.filter(
          (rule) =>
            rule.ruleKind !== "budget_allocation" &&
            ["income", "expense_cash", "expense_card", "transfer"].includes(rule.type),
        ),
      );
      setAccounts(loadedAccounts);
      setCards(loadedCards);
      setCategories(loadedCategories);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "定期記録を読み込めませんでした");
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function confirmDelete(rule: RecurringRule) {
    Alert.alert("定期記録を停止しますか", "生成済みの履歴は残り、次の月から作成されません。", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "停止",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteRecurringRule(db, rule.id);
              await load();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "停止できませんでした");
            }
          })();
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="small" themeColor="textSecondary">
            収入・支出・振替を指定日に自動で記録します。編集は次回以降に反映されます。
          </ThemedText>
          <View style={styles.actions}>
            {(["expense", "income", "transfer"] as const).map((kind) => (
              <Pressable
                key={kind}
                onPress={() => router.push({ pathname: "/input", params: { kind, recurring: "1" } })}
                style={styles.addButton}>
                <ThemedText style={styles.addText}>
                  ＋ {kind === "expense" ? "支出" : kind === "income" ? "収入" : "振替"}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          {!rules && !error ? <ActivityIndicator /> : null}
          {error ? <ThemedText style={styles.warning}>{error}</ThemedText> : null}
          {rules?.length === 0 ? (
            <ThemedView type="backgroundElement" style={styles.empty}>
              <ThemedText type="smallBold">定期記録はまだありません</ThemedText>
              <ThemedText type="small">上のボタンから毎月の内容を入力してください。</ThemedText>
            </ThemedView>
          ) : null}
          {rules?.map((rule) => (
            <ThemedView key={rule.id} type="backgroundElement" style={styles.ruleCard}>
              <View style={styles.ruleHeader}>
                <View style={styles.ruleText}>
                  <ThemedText type="smallBold">{ruleLabel(rule)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    毎月{rule.dayOfMonth === 31 ? "月末" : `${rule.dayOfMonth}日`}・{accountLabel(rule, accounts, cards)}
                  </ThemedText>
                  {rule.categoryId ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {categories.find((category) => category.id === rule.categoryId)?.name ?? "不明なカテゴリ"}
                    </ThemedText>
                  ) : null}
                  {rule.memo ? <ThemedText type="small">{rule.memo}</ThemedText> : null}
                </View>
                <ThemedText type="subtitle">¥{rule.amount.toLocaleString("ja-JP")}</ThemedText>
              </View>
              <View style={styles.rowActions}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: "/input", params: { recurringRuleId: rule.id } })
                  }
                  style={styles.secondaryButton}>
                  <ThemedText type="smallBold">編集</ThemedText>
                </Pressable>
                <Pressable onPress={() => confirmDelete(rule)} style={styles.stopButton}>
                  <ThemedText style={styles.stopText}>停止</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ruleLabel(rule: RecurringRule): string {
  if (rule.type === "income") return "収入";
  if (rule.type === "transfer") return "振替";
  return "支出";
}

function accountLabel(rule: RecurringRule, accounts: Account[], cards: Card[]): string {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  if (rule.type === "income") return names.get(rule.toAccountId ?? "") ?? "不明";
  if (rule.type === "transfer") {
    return `${names.get(rule.fromAccountId ?? "") ?? "不明"} → ${names.get(rule.toAccountId ?? "") ?? "不明"}`;
  }
  const budget = names.get(rule.fromAccountId ?? "") ?? "不明";
  const card = cards.find((item) => item.id === rule.cardId);
  return card ? `${budget} / ${card.name}` : budget;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#f6f7f9", flex: 1 },
  safe: { backgroundColor: "#f6f7f9", flex: 1 },
  content: { gap: 12, padding: 20, paddingBottom: 40 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  addButton: { backgroundColor: "#2563eb", borderRadius: 9, minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  addText: { color: "#ffffff", fontWeight: "700" },
  empty: { backgroundColor: "#ffffff", borderColor: "#e1e5ea", borderRadius: 12, borderWidth: 1, gap: 6, padding: 16 },
  ruleCard: { backgroundColor: "#ffffff", borderColor: "#e1e5ea", borderRadius: 12, borderWidth: 1, gap: 12, padding: 16 },
  ruleHeader: { alignItems: "flex-start", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  ruleText: { flex: 1, gap: 3 },
  rowActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  secondaryButton: { backgroundColor: "#e5e7eb", borderRadius: 8, minHeight: 42, justifyContent: "center", paddingHorizontal: 16 },
  stopButton: { borderColor: "#b42318", borderRadius: 8, borderWidth: 1, minHeight: 42, justifyContent: "center", paddingHorizontal: 16 },
  stopText: { color: "#b42318", fontWeight: "700" },
  warning: { color: "#b42318" },
});
