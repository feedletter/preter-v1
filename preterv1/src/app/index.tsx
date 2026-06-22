import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Brand } from '@/constants/theme';

// Figma에 노출 시간이 명시되어 있지 않아 1.5초로 임시 지정 — 실제 값은 확인 필요.
const SPLASH_DURATION_MS = 1500;

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/welcome');
    }, SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={styles.container}>
      <Image
        source={require('@/assets/images/brand/preter-logo-white.png')}
        style={styles.logo}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 202,
    height: 46,
  },
});
