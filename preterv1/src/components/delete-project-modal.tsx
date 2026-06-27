import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Brand } from '@/constants/theme';

type DeleteProjectModalProps = {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title?: string;
  description?: string;
};

// Project Detail PRD 4장 (SCR-PD-09) — 삭제 확인 모달 (Popup/2 Button horizontal).
// Doc Detail PRD가 "동일 컴포넌트" 재사용을 명시 — title/description으로 일반화.
export function DeleteProjectModal({
  visible,
  onClose,
  onConfirm,
  title,
  description,
}: DeleteProjectModalProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('deleteProjectModal.title');
  const resolvedDescription = description ?? t('deleteProjectModal.description');
  const [deleting, setDeleting] = useState(false);
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      opacity.setValue(0);
      scale.setValue(0.9);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, damping: 16, stiffness: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, scale]);

  async function handleConfirm() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dim} accessibilityViewIsModal>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Text style={styles.title}>{resolvedTitle}</Text>
          <Text style={styles.description}>{resolvedDescription}</Text>
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onClose} disabled={deleting}>
              <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.deleteButton} onPress={handleConfirm} disabled={deleting}>
              {deleting ? <ActivityIndicator color={Brand.error} size="small" /> : <Text style={styles.deleteLabel}>{t('deleteProjectModal.deleteButton')}</Text>}
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 283,
    backgroundColor: 'white',
    borderRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.textPrimary,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    color: Brand.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 20,
    height: 44,
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.textDisabled,
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Brand.error,
  },
});
