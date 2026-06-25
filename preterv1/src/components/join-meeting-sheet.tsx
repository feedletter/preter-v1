import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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
  confirmLabel = '미팅 입장하기',
}: JoinMeetingSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.content}>
        <Text style={styles.illustration}>🎧</Text>
        <Text style={styles.title}>이어폰이 연결되어 있나요?</Text>
        <Text style={styles.description}>
          정확한 동시통역 음성을 듣고 말하기 위해, 미팅 참가 전 이어폰을 착용하고 연결 상태를
          확인해주세요.
        </Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusIcon}>✓</Text>
          <Text style={styles.statusLabel}>이어폰 연결됨</Text>
          <Text style={styles.statusValue}>정상</Text>
        </View>

        <Pressable onPress={onConfirm} disabled={joining} style={styles.confirmButton}>
          {joining ? <ActivityIndicator color="white" /> : <Text style={styles.confirmButtonLabel}>{confirmLabel}</Text>}
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
