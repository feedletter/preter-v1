import * as Haptics from 'expo-haptics';
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
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

const EXTRA_LIFT = Dimensions.get('window').height * 0.15;
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignupProgressBar } from '@/components/signup-progress-bar';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, signup } from '@/lib/auth';
import { logEvent, setAnalyticsUser, setCrashUser } from '@/lib/firebase';
import { resolveDeviceLanguage } from '@/lib/i18n';
import { getSignupDraft, resetSignupDraft, updateSignupDraft } from '@/lib/signup-draft';

const COUNTRY_CODES = [
  { code: '+82', flag: '🇰🇷', nameKey: 'signupProfile.countryKorea' },
  { code: '+1', flag: '🇺🇸', nameKey: 'signupProfile.countryUs' },
  { code: '+81', flag: '🇯🇵', nameKey: 'signupProfile.countryJapan' },
  { code: '+86', flag: '🇨🇳', nameKey: 'signupProfile.countryChina' },
  { code: '+65', flag: '🇸🇬', nameKey: 'signupProfile.countrySingapore' },
] as const;

export default function SignupProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const draft = getSignupDraft();

  const [countryCode, setCountryCode] = useState(draft.countryCode);
  const [phone, setPhone] = useState(draft.phone);
  const [companyEmail, setCompanyEmail] = useState(draft.companyEmail);
  const [companyName, setCompanyName] = useState(draft.companyName);
  const [position, setPosition] = useState(draft.position);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const isValid = phone.trim().length > 0;
  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) ?? COUNTRY_CODES[0];

  async function handleComplete() {
    if (!isValid || loading) return;
    setLoading(true);
    try {
      updateSignupDraft({ phone, countryCode, companyEmail, companyName, position });
      const finalDraft = getSignupDraft();
      const result = await signup({
        primary_language: finalDraft.primaryLanguage,
        // 가입 시점 디바이스 로캘 → 앱 UI 언어 초기값 (정책 §2, 통역 언어와 별개).
        app_language: resolveDeviceLanguage(),
        name: finalDraft.name,
        email: finalDraft.email,
        password: finalDraft.password,
        phone: finalDraft.phone,
        country_code: finalDraft.countryCode,
        company_email: finalDraft.companyEmail || undefined,
        position: finalDraft.position || undefined,
        company_name: finalDraft.companyName || undefined,
      });
      setAnalyticsUser(result.user.id);
      setCrashUser(result.user.id);
      logEvent('sign_up', { method: 'email' });
      resetSignupDraft();
      router.replace('/main');
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'EMAIL_ALREADY_EXISTS') {
        Alert.alert(t('signupProfile.emailTaken'));
      } else if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert(t('common.networkError'));
      } else {
        Alert.alert(t('signupProfile.signupFailed'));
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
        <Text style={styles.topBarTitle}>{t('signupProfile.topBarTitle')}</Text>
      </View>

      <SignupProgressBar step={3} total={3} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.five + EXTRA_LIFT }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.phoneField}>
          <View style={styles.phoneLabelRow}>
            <Text style={styles.label}>{t('signupProfile.phoneLabel')}</Text>
            <View style={styles.requiredDot} />
          </View>
          <View style={styles.phoneRow}>
            <Pressable
              style={styles.countryCodeButton}
              onPress={() => setCountryPickerOpen((prev) => !prev)}>
              <Text style={styles.flag}>{selectedCountry.flag}</Text>
              <Text style={styles.countryCodeText}>{selectedCountry.code}</Text>
              <Text style={styles.chevron}>▾</Text>
            </Pressable>
            <View style={styles.dividerV} />
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('signupProfile.phonePlaceholder')}
              placeholderTextColor={Brand.textDisabled}
              keyboardType="number-pad"
            />
          </View>
          <Text style={styles.helperText}>{t('signupProfile.phoneHelper')}</Text>

          {countryPickerOpen && (
            <View style={styles.countryOptions}>
              {COUNTRY_CODES.map((c) => (
                <Pressable
                  key={c.code}
                  style={styles.countryOption}
                  onPress={() => {
                    setCountryCode(c.code);
                    setCountryPickerOpen(false);
                  }}>
                  <Text style={styles.flag}>{c.flag}</Text>
                  <Text style={styles.countryOptionLabel}>{t(c.nameKey)}</Text>
                  <Text style={styles.countryOptionCode}>{c.code}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.fields}>
          <TextField
            label={t('signupProfile.companyEmailLabel')}
            value={companyEmail}
            onChangeText={setCompanyEmail}
            placeholder={t('signupProfile.companyEmailPlaceholder')}
            keyboardType="email-address"
            helperText={t('signupProfile.companyEmailHelper')}
          />
          <TextField
            label={t('signupProfile.companyNameLabel')}
            value={companyName}
            onChangeText={setCompanyName}
            placeholder={t('signupProfile.companyNamePlaceholder')}
            helperText={t('signupProfile.companyNameHelper')}
          />
          <TextField
            label={t('signupProfile.positionLabel')}
            value={position}
            onChangeText={setPosition}
            placeholder={t('signupProfile.positionPlaceholder')}
            helperText={t('signupProfile.positionHelper')}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleComplete}
          disabled={!isValid || loading}
          style={[styles.completeButton, !isValid && styles.completeButtonDisabled]}>
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.completeButtonLabel}>{t('signupProfile.completeButton')}</Text>
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
    paddingTop: 20,
    paddingBottom: Spacing.five,
    gap: 30,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textSecondary,
  },
  phoneField: {},
  phoneLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  requiredDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Brand.requiredDot,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  countryCodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 82,
    height: 40,
    borderBottomWidth: 1.5,
    borderBottomColor: Brand.primary,
  },
  flag: {
    fontSize: 18,
  },
  countryCodeText: {
    fontSize: 16,
    color: Brand.textPrimary,
  },
  chevron: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  dividerV: {
    width: 1,
    height: 24,
    backgroundColor: Brand.divider,
    marginHorizontal: 12,
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    color: Brand.textPrimary,
    height: 40,
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
    padding: 0,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 20,
    color: Brand.textDisabled,
    marginTop: 8,
  },
  countryOptions: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: Brand.divider,
    overflow: 'hidden',
  },
  countryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Brand.divider,
  },
  countryOptionLabel: {
    flex: 1,
    fontSize: 16,
    color: Brand.textPrimary,
  },
  countryOptionCode: {
    fontSize: 14,
    color: Brand.textSecondary,
  },
  fields: {
    gap: 30,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  completeButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeButtonDisabled: {
    backgroundColor: Brand.divider,
  },
  completeButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
});
