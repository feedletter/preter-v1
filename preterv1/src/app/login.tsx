import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

const EXTRA_LIFT = Dimensions.get('window').height * 0.15;
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, login } from '@/lib/auth';
import { logEvent, setAnalyticsUser, setCrashUser } from '@/lib/firebase';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const CREDENTIALS_ERROR_MESSAGE = t('login.credentialsError');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const isValid = EMAIL_RE.test(email) && password.length >= 8;

  function handleChangeEmail(text: string) {
    setEmail(text);
    setHasError(false);
  }

  function handleChangePassword(text: string) {
    setPassword(text);
    setHasError(false);
  }

  async function handleLogin() {
    if (!isValid || loading) return;
    setLoading(true);
    setHasError(false);
    try {
      const result = await login(email, password);
      setAnalyticsUser(result.user.id);
      setCrashUser(result.user.id);
      logEvent('login', { method: 'email' });
      router.replace('/main');
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'INVALID_CREDENTIALS') {
        setHasError(true);
      } else if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert(t('common.networkError'));
      } else {
        Alert.alert(t('login.loginFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{t('login.topBarTitle')}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.five + EXTRA_LIFT }]}
        keyboardShouldPersistTaps="handled">
        <Image
          source={require('@/assets/images/brand/preter-logo-primary.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

        <View style={styles.fields}>
          <TextField
            label={t('login.emailLabel')}
            required
            value={email}
            onChangeText={handleChangeEmail}
            placeholder={t('login.emailPlaceholder')}
            keyboardType="email-address"
            returnKeyType="next"
            editable={!loading}
            error={hasError ? CREDENTIALS_ERROR_MESSAGE : undefined}
          />
          <TextField
            label={t('login.passwordLabel')}
            required
            value={password}
            onChangeText={handleChangePassword}
            placeholder={t('login.passwordPlaceholder')}
            secureTextEntry
            returnKeyType="done"
            editable={!loading}
            onSubmitEditing={handleLogin}
            error={hasError ? CREDENTIALS_ERROR_MESSAGE : undefined}
          />
        </View>

        <Pressable hitSlop={8} style={styles.forgotPassword}>
          <Text style={styles.forgotPasswordText}>{t('login.forgotPassword')}</Text>
        </Pressable>

        <Pressable
          onPress={handleLogin}
          disabled={!isValid || loading}
          style={[styles.loginButton, !isValid && styles.loginButtonDisabled]}>
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.loginButtonLabel}>{t('login.loginButton')}</Text>
          )}
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('common.or')}</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable style={styles.signupButton} onPress={() => router.push('/signup-card-intro')}>
          <Text style={styles.signupButtonLabel}>{t('login.signupButton')}</Text>
        </Pressable>

        <Text style={styles.terms}>{t('login.terms')}</Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: 20,
    top: 16,
  },
  backIcon: {
    fontSize: 28,
    color: Brand.textPrimary,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  logo: {
    width: 104,
    height: 25,
    alignSelf: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Brand.textSecondary,
    textAlign: 'center',
    marginTop: 18,
  },
  fields: {
    marginTop: 28,
    gap: 26,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginTop: 16,
  },
  forgotPasswordText: {
    fontSize: 13,
    color: Brand.primary,
  },
  loginButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  loginButtonDisabled: {
    opacity: 0.4,
  },
  loginButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Brand.divider,
  },
  dividerText: {
    fontSize: 13,
    color: Brand.textSecondary,
  },
  signupButton: {
    borderWidth: 1,
    borderColor: Brand.border,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  signupButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.textPrimary,
  },
  terms: {
    fontSize: 12,
    color: Brand.textDisabled,
    textAlign: 'center',
    marginTop: 16,
  },
});
