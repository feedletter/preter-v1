import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageDropdown } from '@/components/language-dropdown';
import { SignupProgressBar } from '@/components/signup-progress-bar';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { AuthApiError, completeSnsSignup } from '@/lib/auth';
import { logEvent } from '@/lib/firebase';
import { getSnsDraft, resetSnsDraft } from '@/lib/sns-draft';

export default function SnsSignupFormScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
      logEvent('sign_up', { method: 'sns' });
      resetSnsDraft();
      router.replace('/main');
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert(t('common.networkError'));
      } else {
        Alert.alert(t('snsSignupForm.signupFailed'));
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
        <Text style={styles.topBarTitle}>{t('snsSignupForm.topBarTitle')}</Text>
      </View>

      <SignupProgressBar step={2} total={2} />

      <View style={styles.content}>
        <Text style={styles.title}>{t('snsSignupForm.title')}</Text>
        <Text style={styles.hint}>{t('snsSignupForm.hint')}</Text>

        <View style={styles.fields}>
          <LanguageDropdown value={language} onChange={setLanguage} />

          <TextField
            label={t('snsSignupForm.nameLabel')}
            required
            value={name}
            onChangeText={setName}
            placeholder={t('snsSignupForm.namePlaceholder')}
            helperText={t('snsSignupForm.nameHelper')}
          />

          <TextField
            label={t('snsSignupForm.emailLabel')}
            required
            value={draft.email}
            onChangeText={() => {}}
            editable={false}
            helperText={t('snsSignupForm.emailHelper')}
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
            <Text style={styles.completeButtonLabel}>{t('snsSignupForm.completeButton')}</Text>
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
