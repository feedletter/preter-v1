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
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageDropdown } from '@/components/language-dropdown';
import { SignupProgressBar } from '@/components/signup-progress-bar';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, checkEmailAvailable } from '@/lib/auth';
import { getSignupDraft, updateSignupDraft } from '@/lib/signup-draft';

const EXTRA_LIFT = Dimensions.get('window').height * 0.15;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function SignupFormScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const draft = getSignupDraft();

  const [language, setLanguage] = useState(draft.primaryLanguage);
  const [name, setName] = useState(draft.name);
  const [email, setEmail] = useState(draft.email);
  const [password, setPassword] = useState(draft.password);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [checkingEmail, setCheckingEmail] = useState(false);

  const isValid = name.trim().length > 0 && EMAIL_RE.test(email) && password.length >= 8;

  function handleEmailChange(text: string) {
    setEmail(text);
    setEmailError(undefined);
  }

  async function handleNext() {
    if (!isValid || checkingEmail) return;
    if (!EMAIL_RE.test(email)) {
      setEmailError(t('signupForm.emailFormatError'));
      return;
    }

    setCheckingEmail(true);
    try {
      const available = await checkEmailAvailable(email);
      if (!available) {
        setEmailError(t('signupForm.emailTakenError'));
        return;
      }
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert(t('common.networkError'));
      } else {
        Alert.alert(t('signupForm.emailCheckFailed'));
      }
      return;
    } finally {
      setCheckingEmail(false);
    }

    updateSignupDraft({ primaryLanguage: language, name, email, password });
    router.push('/signup-profile');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{t('signupForm.topBarTitle')}</Text>
      </View>

      <SignupProgressBar step={2} total={3} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.five + EXTRA_LIFT }]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('signupForm.title')}</Text>
        <Text style={styles.hint}>{t('signupForm.hint')}</Text>

        <View style={styles.fields}>
          <LanguageDropdown value={language} onChange={setLanguage} />

          <TextField
            label={t('signupForm.nameLabel')}
            required
            value={name}
            onChangeText={setName}
            placeholder={t('signupForm.namePlaceholder')}
            helperText={t('signupForm.nameHelper')}
          />

          <TextField
            label={t('signupForm.emailLabel')}
            required
            value={email}
            onChangeText={handleEmailChange}
            placeholder={t('signupForm.emailPlaceholder')}
            keyboardType="email-address"
            helperText={emailError ? undefined : t('signupForm.emailHelper')}
            error={emailError}
          />

          <TextField
            label={t('signupForm.passwordLabel')}
            required
            value={password}
            onChangeText={setPassword}
            placeholder={t('signupForm.passwordPlaceholder')}
            secureTextEntry
            helperText={t('signupForm.passwordHelper')}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleNext}
          disabled={!isValid || checkingEmail}
          style={[styles.nextButton, !isValid && styles.nextButtonDisabled]}>
          {checkingEmail ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={[styles.nextButtonLabel, !isValid && styles.nextButtonLabelDisabled]}>
              {t('common.next')}
            </Text>
          )}
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.surfaceBackground,
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
    paddingTop: 16,
    paddingBottom: Spacing.five,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  hint: {
    fontSize: 12,
    color: Brand.primary,
    marginTop: 8,
  },
  fields: {
    marginTop: 24,
    gap: 30,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  nextButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: Brand.divider,
  },
  nextButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
  nextButtonLabelDisabled: {
    color: Brand.textDisabled,
  },
});
