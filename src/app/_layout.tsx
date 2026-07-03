// ルートレイアウト（土台所有ファイル）。M3〜M6 は編集しない。
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DbProvider } from '@/db/provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DbProvider>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="input" options={{ presentation: 'modal', headerShown: true }} />
          <Stack.Screen name="card/[id]" options={{ headerShown: true }} />
        </Stack>
      </DbProvider>
    </ThemeProvider>
  );
}
