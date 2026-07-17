/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';

export function useTheme() {
  // v1 は画面ごとのdark対応が未完了のためlightへ統一する。
  // 一部だけdark化して入力欄が読めなくなる状態を避け、対応時に全画面を一括検証する。
  return Colors.light;
}
