import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignupProgressBar } from '@/components/signup-progress-bar';
import { Brand, Spacing } from '@/constants/theme';
import { BusinessCardApiError, scanBusinessCard } from '@/lib/business-card';
import { updateSignupDraft } from '@/lib/signup-draft';

export default function SignupCardIntroScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);

  async function handleScanCard() {
    if (scanning) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('signupCardIntro.cameraPermissionTitle'), t('signupCardIntro.cameraPermissionBody'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: true });
    if (result.canceled || !result.assets[0]) return;

    setScanning(true);
    try {
      const parsed = await scanBusinessCard(result.assets[0].uri);
      // 명함에서 못 읽은 필드는 키 자체를 안 넣어야 한다 — undefined를 넣으면
      // updateSignupDraft의 {...draft, ...partial} 스프레드가 기존 값을 덮어써 지워버린다.
      const patch: Record<string, string> = {};
      if (parsed.name) patch.name = parsed.name;
      if (parsed.company_email) patch.companyEmail = parsed.company_email;
      if (parsed.phone) patch.phone = parsed.phone.replace(/\D/g, '');
      if (parsed.company_name) patch.companyName = parsed.company_name;
      if (parsed.position) patch.position = parsed.position;
      updateSignupDraft(patch);
      if (!parsed.name && !parsed.company_email && !parsed.phone) {
        Alert.alert(t('signupCardIntro.scanFailedTitle'), t('signupCardIntro.enterManually'));
      }
      router.push('/signup-form');
    } catch (err) {
      if (err instanceof BusinessCardApiError && err.code === 'NETWORK_ERROR') {
        Alert.alert(t('common.networkError'));
      } else {
        Alert.alert(t('signupCardIntro.scanFailedTitle'), t('signupCardIntro.enterManually'));
      }
    } finally {
      setScanning(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{t('signupCardIntro.topBarTitle')}</Text>
      </View>

      <SignupProgressBar step={1} total={3} />

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
          disabled={scanning}
          onPress={handleScanCard}
          accessibilityRole="button">
          {scanning ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.primaryButtonLabel}>{t('signupCardIntro.scanButton')}</Text>
          )}
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          disabled={scanning}
          onPress={() => router.push('/signup-form')}>
          <Text style={styles.secondaryButtonLabel}>{t('signupCardIntro.manualButton')}</Text>
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
