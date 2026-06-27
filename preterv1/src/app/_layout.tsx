import { useEffect } from 'react';

import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import '@/lib/i18n';
import { installGlobalErrorHandlers, logScreenView, requestFcmToken } from '@/lib/firebase';

installGlobalErrorHandlers();

function ScreenViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    logScreenView(pathname);
  }, [pathname]);

  return null;
}

export default function RootLayout() {
  useEffect(() => {
    requestFcmToken().then((token) => {
      if (token) console.log('[FCM] token', token);
    });
  }, []);

  return (
    // SafeAreaProvider가 루트에 없으면 새로 push된 화면에서 useSafeAreaInsets/SafeAreaView가
    // 첫 프레임엔 insets=0을 반환하고 실제 측정값으로 한 프레임 뒤에 갱신된다 — 라이브
    // 세션처럼 상단바/하단바가 고정 높이인 화면에서 이게 "화면 진입 시 헤더/바텀바가
    // 잠깐 영역 밖으로 빠졌다가 들어오는" 점프로 보였다. initialWindowMetrics를 넘기면
    // 앱 시작 시점에 측정된 insets를 동기적으로 즉시 사용해 그 점프가 없어진다.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" />
      <ScreenViewTracker />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup-card-intro" />
        <Stack.Screen name="signup-form" />
        <Stack.Screen name="signup-profile" />
        <Stack.Screen name="sns-signup-card-intro" />
        <Stack.Screen name="sns-signup-form" />
        <Stack.Screen name="guest-meeting-input" />
        <Stack.Screen name="create-meeting" />
        <Stack.Screen name="create-project" />
        <Stack.Screen name="host-live-session" />
        <Stack.Screen name="subscription" />
        <Stack.Screen name="profile-info" />
        <Stack.Screen name="main" />
        <Stack.Screen name="project-detail" />
        <Stack.Screen name="doc-detail" />
      </Stack>
    </SafeAreaProvider>
  );
}
