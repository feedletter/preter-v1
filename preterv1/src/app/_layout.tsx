import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup-card-intro" />
        <Stack.Screen name="signup-form" />
        <Stack.Screen name="signup-profile" />
        <Stack.Screen name="sns-signup-card-intro" />
        <Stack.Screen name="sns-signup-form" />
        <Stack.Screen name="main" />
      </Stack>
    </>
  );
}
