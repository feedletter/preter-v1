import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, signInWithOAuth } from '@/lib/auth';
import { setSnsDraft } from '@/lib/sns-draft';

function showComingSoon(provider: string) {
  Alert.alert('준비 중', `${provider} 로그인은 아직 지원되지 않습니다.`);
}

function ContinueButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
      {icon}
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const [snsLoading, setSnsLoading] = useState<'google' | 'apple' | null>(null);

  async function handleSnsLogin(provider: 'google' | 'apple') {
    if (snsLoading) return;
    setSnsLoading(provider);
    try {
      const result = await signInWithOAuth(provider);
      if (result.user.is_onboarded) {
        router.replace('/main');
      } else {
        setSnsDraft({
          name: result.user.name ?? '',
          email: result.user.email ?? '',
        });
        router.push('/sns-signup-card-intro');
      }
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'SNS_CANCELLED') {
        return;
      }
      if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert('네트워크 연결을 확인해주세요');
      } else {
        Alert.alert('로그인에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setSnsLoading(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <Image
          source={require('@/assets/images/brand/preter-logo-white.png')}
          style={styles.logo}
          contentFit="contain"
        />
      </View>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>환영합니다</Text>
          <Text style={styles.subtitle}>프리터 시작하기</Text>
        </View>

        <View style={styles.buttonGroup}>
          <ContinueButton label="이메일로 계속" onPress={() => router.push('/login')} />
          <ContinueButton
            label="Google로 계속"
            icon={
              snsLoading === 'google' ? (
                <ActivityIndicator color={Brand.textPrimary} />
              ) : (
                <View style={styles.googleIcon}>
                  <Text style={styles.googleIconLabel}>G</Text>
                </View>
              )
            }
            onPress={() => handleSnsLogin('google')}
          />
          <ContinueButton
            label="Apple로 계속"
            icon={
              snsLoading === 'apple' ? (
                <ActivityIndicator color={Brand.textPrimary} />
              ) : (
                <Image
                  source={require('@/assets/images/brand/apple-icon.png')}
                  style={styles.appleIcon}
                  contentFit="contain"
                />
              )
            }
            onPress={() => handleSnsLogin('apple')}
          />
          <ContinueButton
            label="게스트로 미팅 참여"
            onPress={() => showComingSoon('게스트 미팅 참여')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.primary,
  },
  heroSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 202,
    height: 46,
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  titleGroup: {
    alignItems: 'center',
    gap: 9,
  },
  title: {
    fontSize: 23,
    fontWeight: '700',
    lineHeight: 32,
    color: Brand.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: Brand.textDisabled,
  },
  buttonGroup: {
    gap: 10,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Brand.surfaceBackground,
    borderRadius: 8,
    paddingVertical: 16,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 26,
    color: Brand.textPrimary,
  },
  googleIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconLabel: {
    fontSize: 12.1,
    fontWeight: '700',
    color: '#EA4335',
  },
  appleIcon: {
    width: 18,
    height: 20,
  },
});
