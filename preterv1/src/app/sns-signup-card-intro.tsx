import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignupProgressBar } from '@/components/signup-progress-bar';
import { Brand, Spacing } from '@/constants/theme';

export default function SnsSignupCardIntroScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{t('snsSignupCardIntro.topBarTitle')}</Text>
      </View>

      <SignupProgressBar step={1} total={2} />

      <View style={styles.content}>
        <View style={styles.cardIllustration}>
          <View style={styles.cardBack} />
          <View style={styles.card}>
            <Text style={styles.cardName}>{t('signupCardIntro.sampleCardName')}</Text>
            <Text style={styles.cardMeta}>{t('signupCardIntro.sampleCardPosition')}</Text>
            <Text style={styles.cardMeta}>{t('signupCardIntro.sampleCardCompany')}</Text>
            <Text style={styles.cardEmail}>{t('signupCardIntro.sampleCardEmail')}</Text>
          </View>
        </View>

        <Text style={styles.title}>{t('signupCardIntro.title')}</Text>
        <Text style={styles.subtitle}>{t('signupCardIntro.subtitle')}</Text>
      </View>

      <View style={styles.buttonGroup}>
        <Pressable
          style={styles.primaryButton}
          onPress={() =>
            Alert.alert(t('snsSignupCardIntro.comingSoonTitle'), t('snsSignupCardIntro.comingSoonBody'))
          }>
          <Text style={styles.primaryButtonLabel}>{t('signupCardIntro.scanButton')}</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push('/sns-signup-form')}>
          <Text style={styles.secondaryButtonLabel}>{t('snsSignupCardIntro.enterLaterButton')}</Text>
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
    alignItems: 'center',
  },
  cardIllustration: {
    width: 236,
    height: 156,
    borderRadius: 20,
    backgroundColor: '#E8EBFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  cardBack: {
    position: 'absolute',
    width: 196,
    height: 114,
    borderRadius: 10,
    backgroundColor: '#C5CCFF',
    top: 20,
    left: 8,
  },
  card: {
    width: 196,
    height: 114,
    borderRadius: 10,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: Brand.divider,
    padding: 12,
    gap: 2,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  cardMeta: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  cardEmail: {
    fontSize: 11,
    color: Brand.primary,
    marginTop: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Brand.textPrimary,
    textAlign: 'center',
    marginTop: 32,
  },
  subtitle: {
    fontSize: 15,
    color: Brand.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  buttonGroup: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Brand.border,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.textPrimary,
  },
});
