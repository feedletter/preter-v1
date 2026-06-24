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
        <Stack.Screen name="guest-meeting-input" />
        <Stack.Screen name="create-meeting" />
        <Stack.Screen name="subscription" />
        <Stack.Screen name="profile-info" />
        <Stack.Screen name="main" />
      </Stack>
    </>
  );
}
