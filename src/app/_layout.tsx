// ルートレイアウト（土台所有ファイル）。M3〜M6 は編集しない。
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DbProvider } from '@/db/provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <DbProvider>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="input" options={{ presentation: 'modal', headerShown: true }} />
          <Stack.Screen name="transfer" options={{ presentation: 'modal', headerShown: true, title: '予算を移す' }} />
          <Stack.Screen name="card/[id]" options={{ headerShown: true }} />
          <Stack.Screen name="transaction/[id]" options={{ headerShown: true, title: '記録の詳細' }} />
        </Stack>
      </DbProvider>
    </ThemeProvider>
  );
}
