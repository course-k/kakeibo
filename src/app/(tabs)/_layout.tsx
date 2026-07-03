// タブレイアウト（土台所有ファイル）。ホーム / レポート / 設定 の3タブ。M3〜M6 は編集しない。
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'ホーム',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              tintColor={color}
              name={{ ios: 'house', android: 'home', web: 'home' }}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'レポート',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              tintColor={color}
              name={{ ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' }}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '設定',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              tintColor={color}
              name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
