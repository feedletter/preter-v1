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

const EXTRA_LIFT = Dimensions.get('window').height * 0.15;
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignupProgressBar } from '@/components/signup-progress-bar';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, signup } from '@/lib/auth';
import { getSignupDraft, resetSignupDraft, updateSignupDraft } from '@/lib/signup-draft';

const COUNTRY_CODES = [
  { code: '+82', flag: '🇰🇷', name: '한국' },
  { code: '+1', flag: '🇺🇸', name: '미국' },
  { code: '+81', flag: '🇯🇵', name: '일본' },
  { code: '+86', flag: '🇨🇳', name: '중국' },
  { code: '+65', flag: '🇸🇬', name: '싱가포르' },
] as const;

export default function SignupProfileScreen() {
  const router = useRouter();
  const draft = getSignupDraft();

  const [countryCode, setCountryCode] = useState(draft.countryCode);
  const [phone, setPhone] = useState(draft.phone);
  const [companyEmail, setCompanyEmail] = useState(draft.companyEmail);
  const [position, setPosition] = useState(draft.position);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const isValid = phone.trim().length > 0;
  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) ?? COUNTRY_CODES[0];

  async function handleComplete() {
    if (!isValid || loading) return;
    setLoading(true);
    try {
      updateSignupDraft({ phone, countryCode, companyEmail, position });
      const finalDraft = getSignupDraft();
      await signup({
        primary_language: finalDraft.primaryLanguage,
        name: finalDraft.name,
        email: finalDraft.email,
        password: finalDraft.password,
        phone: finalDraft.phone,
        country_code: finalDraft.countryCode,
        company_email: finalDraft.companyEmail || undefined,
        position: finalDraft.position || undefined,
      });
      resetSignupDraft();
      router.replace('/main');
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'EMAIL_ALREADY_EXISTS') {
        Alert.alert('이미 사용 중인 이메일이에요');
      } else if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert('네트워크 연결을 확인해주세요');
      } else {
        Alert.alert('회원가입에 실패했어요. 잠시 후 다시 시도해주세요.');
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
        <Text style={styles.topBarTitle}>회원가입</Text>
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
            <Text style={styles.label}>휴대폰 번호</Text>
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
              placeholder="010-1234-5678"
              placeholderTextColor={Brand.textDisabled}
              keyboardType="number-pad"
            />
          </View>
          <Text style={styles.helperText}>하이픈(-) 없이 숫자만 입력해주세요</Text>

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
                  <Text style={styles.countryOptionLabel}>{c.name}</Text>
                  <Text style={styles.countryOptionCode}>{c.code}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.fields}>
          <TextField
            label="회사 이메일"
            value={companyEmail}
            onChangeText={setCompanyEmail}
            placeholder="회사 이메일을 입력해주세요"
            keyboardType="email-address"
            helperText="회사 이메일은 선택 항목이에요"
          />
          <TextField
            label="회사 직책"
            value={position}
            onChangeText={setPosition}
            placeholder="직책을 입력해주세요"
            helperText="명함에서 인식된 직책을 확인해주세요"
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
            <Text style={styles.completeButtonLabel}>회원가입 완료</Text>
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
