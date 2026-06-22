import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Spacing } from '@/constants/theme';

// TODO: "Login - Typing" Figma 화면(node 256:297) 구현 예정. 지금은 플로우 연결만 확인하는 placeholder.
export default function LoginScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.back}>{'< 뒤로'}</Text>
      </Pressable>
      <Text style={styles.text}>이메일 로그인 화면 (준비 중)</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    padding: Spacing.four,
    gap: Spacing.four,
  },
  back: {
    fontSize: 15,
    color: Brand.textSecondary,
  },
  text: {
    fontSize: 16,
    color: Brand.textPrimary,
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
