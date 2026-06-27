import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Spacing } from '@/constants/theme';

type EarphoneCheckSheetProps = {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  joining?: boolean;
  /** PRD table29 P3: 미팅 시작 전(E1) 카운트다운 안내 — 있으면 참가 버튼을 비활성화한다 */
  countdownText?: string;
};

export function EarphoneCheckSheet({
  visible,
  onConfirm,
  onCancel,
  joining,
  countdownText,
}: EarphoneCheckSheetProps) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} hitSlop={8} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.topBarTitle}>{t('earphoneCheckSheet.topBarTitle')}</Text>
        </View>

        <View style={styles.content}>
          <Text style={styles.illustration}>🎧</Text>
          <Text style={styles.title}>{t('earphoneCheckSheet.title')}</Text>
          <Text style={styles.description}>{t('earphoneCheckSheet.description')}</Text>

          <View style={styles.statusCard}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>{t('earphoneCheckSheet.statusText')}</Text>
          </View>

          {countdownText && (
            <View style={styles.countdownCard}>
              <Text style={styles.countdownText}>{countdownText}</Text>
              <Text style={styles.countdownSubtext}>{t('earphoneCheckSheet.countdownSubtext')}</Text>
            </View>
          )}
        </View>

        <View style={styles.bottomSection}>
          <Pressable
            onPress={onConfirm}
            disabled={joining || !!countdownText}
            style={[styles.joinButton, !!countdownText && styles.joinButtonDisabled]}>
            <Text style={styles.joinButtonLabel}>
              {countdownText
                ? t('earphoneCheckSheet.waitingForStart')
                : joining
                  ? t('earphoneCheckSheet.joining')
                  : t('earphoneCheckSheet.joinButton')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
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
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.six,
  },
  illustration: {
    fontSize: 72,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Brand.textPrimary,
    marginTop: Spacing.four,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: Brand.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Brand.surfaceBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: Spacing.five,
    width: '100%',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#06C755',
  },
  statusText: {
    fontSize: 13,
    color: Brand.textSecondary,
    flex: 1,
  },
  countdownCard: {
    backgroundColor: Brand.surfaceBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: Spacing.three,
    width: '100%',
    alignItems: 'center',
    gap: 4,
  },
  countdownText: {
    fontSize: 14,
    fontWeight: '600',
    color: Brand.primary,
  },
  countdownSubtext: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  bottomSection: {
    paddingHorizontal: Spacing.four,
    paddingVertical: 10,
  },
  joinButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  joinButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
});
