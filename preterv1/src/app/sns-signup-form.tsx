import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageDropdown } from '@/components/language-dropdown';
import { SignupProgressBar } from '@/components/signup-progress-bar';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, completeSnsSignup } from '@/lib/auth';
import { getSnsDraft, resetSnsDraft } from '@/lib/sns-draft';

export default function SnsSignupFormScreen() {
  const router = useRouter();
  const draft = getSnsDraft();

  const [language, setLanguage] = useState(draft.primaryLanguage);
  const [name, setName] = useState(draft.name);
  const [loading, setLoading] = useState(false);

  const isValid = name.trim().length > 0;

  async function handleComplete() {
    if (!isValid || loading) return;
    setLoading(true);
    try {
      await completeSnsSignup(language, name);
      resetSnsDraft();
      router.replace('/main');
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
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
        <Text style={styles.topBarTitle}>회원 정보</Text>
      </View>

      <SignupProgressBar step={2} total={2} />

      <View style={styles.content}>
        <Text style={styles.title}>회원 정보를 입력해주세요</Text>
        <Text style={styles.hint}>SNS 정보가 자동 입력되었어요</Text>

        <View style={styles.fields}>
          <LanguageDropdown value={language} onChange={setLanguage} />

          <TextField
            label="사용자 이름"
            required
            value={name}
            onChangeText={setName}
            placeholder="이름을 입력해주세요"
            helperText="명함에서 인식된 이름을 확인해주세요"
          />

          <TextField
            label="계정 로그인 이메일"
            required
            value={draft.email}
            onChangeText={() => {}}
            editable={false}
            helperText="SNS 계정에 연결된 이메일이에요"
          />
        </View>
      </View>

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
  content: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: 16,
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
