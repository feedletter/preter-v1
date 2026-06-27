import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, signInWithOAuth } from '@/lib/auth';
import { logEvent, setAnalyticsUser, setCrashUser } from '@/lib/firebase';
import { setSnsDraft } from '@/lib/sns-draft';

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
  const { t } = useTranslation();
  const [snsLoading, setSnsLoading] = useState<'google' | 'apple' | null>(null);

  async function handleSnsLogin(provider: 'google' | 'apple') {
    if (snsLoading) return;
    setSnsLoading(provider);
    try {
      const result = await signInWithOAuth(provider);
      setAnalyticsUser(result.user.id);
      setCrashUser(result.user.id);
      if (result.user.is_onboarded) {
        logEvent('login', { method: provider });
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
        Alert.alert(t('common.networkError'));
      } else {
        Alert.alert(t('welcome.loginFailed'));
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
          <Text style={styles.title}>{t('welcome.title')}</Text>
          <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>
        </View>

        <View style={styles.buttonGroup}>
          <ContinueButton label={t('welcome.continueWithEmail')} onPress={() => router.push('/login')} />
          <ContinueButton
            label={t('welcome.continueWithGoogle')}
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
            label={t('welcome.continueWithApple')}
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
            label={t('welcome.continueAsGuest')}
            onPress={() => router.push('/guest-meeting-input')}
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
