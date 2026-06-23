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

const EXTRA_LIFT = Dimensions.get('window').height * 0.15;
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, login } from '@/lib/auth';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CREDENTIALS_ERROR_MESSAGE = '이메일 또는 비밀번호를 확인해주세요';

export default function LoginScreen() {
  const router = useRouter();
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
      await login(email, password);
      router.replace('/main');
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'INVALID_CREDENTIALS') {
        setHasError(true);
      } else if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert('네트워크 연결을 확인해주세요');
      } else {
        Alert.alert('로그인에 실패했어요. 잠시 후 다시 시도해주세요.');
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
        <Text style={styles.topBarTitle}>이메일로 로그인</Text>
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
        <Text style={styles.subtitle}>계정에 로그인하세요</Text>

        <View style={styles.fields}>
          <TextField
            label="이메일"
            required
            value={email}
            onChangeText={handleChangeEmail}
            placeholder="이메일을 입력해주세요"
            keyboardType="email-address"
            returnKeyType="next"
            editable={!loading}
            error={hasError ? CREDENTIALS_ERROR_MESSAGE : undefined}
          />
          <TextField
            label="비밀번호"
            required
            value={password}
            onChangeText={handleChangePassword}
            placeholder="비밀번호를 입력해주세요"
            secureTextEntry
            returnKeyType="done"
            editable={!loading}
            onSubmitEditing={handleLogin}
            error={hasError ? CREDENTIALS_ERROR_MESSAGE : undefined}
          />
        </View>

        <Pressable hitSlop={8} style={styles.forgotPassword}>
          <Text style={styles.forgotPasswordText}>비밀번호 찾기</Text>
        </Pressable>

        <Pressable
          onPress={handleLogin}
          disabled={!isValid || loading}
          style={[styles.loginButton, !isValid && styles.loginButtonDisabled]}>
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.loginButtonLabel}>로그인</Text>
          )}
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable style={styles.signupButton} onPress={() => router.push('/signup-card-intro')}>
          <Text style={styles.signupButtonLabel}>회원가입</Text>
        </Pressable>

        <Text style={styles.terms}>회원가입 시 이용약관 및 개인정보처리방침에 동의합니다</Text>
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
