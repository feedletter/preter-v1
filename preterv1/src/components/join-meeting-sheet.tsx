import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';

type JoinMeetingSheetProps = {
  visible: boolean;
  joining?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Join Meeting PRD 3.4 — Create는 "미팅 입장하기", Join은 "미팅 참가하기". */
  confirmLabel?: string;
};

// Create Meeting PRD 3.3.1 (Join BottomSheet · Node: 386:25938) — 즉시 입장 분기 시 표시.
export function JoinMeetingSheet({
  visible,
  joining,
  onConfirm,
  onClose,
  confirmLabel,
}: JoinMeetingSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.content}>
        <Text style={styles.illustration}>🎧</Text>
        <Text style={styles.title}>{t('joinMeetingSheet.title')}</Text>
        <Text style={styles.description}>{t('joinMeetingSheet.description')}</Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusIcon}>✓</Text>
          <Text style={styles.statusLabel}>{t('joinMeetingSheet.statusLabel')}</Text>
          <Text style={styles.statusValue}>{t('joinMeetingSheet.statusValue')}</Text>
        </View>

        <Pressable onPress={onConfirm} disabled={joining} style={styles.confirmButton}>
          {joining ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.confirmButtonLabel}>{confirmLabel ?? t('joinMeetingSheet.confirmDefault')}</Text>
          )}
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 536,
  },
  content: {
    alignItems: 'center',
    paddingTop: 8,
    gap: 24,
  },
  illustration: {
    fontSize: 72,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: '#8E8E93',
    textAlign: 'center',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#E8F8EE',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: '100%',
  },
  statusIcon: {
    fontSize: 18,
    color: '#34C759',
  },
  statusLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  statusValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#34C759',
  },
  confirmButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 56,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
});
