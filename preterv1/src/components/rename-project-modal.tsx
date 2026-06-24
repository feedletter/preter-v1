import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Brand } from '@/constants/theme';

type RenameProjectModalProps = {
  visible: boolean;
  currentName: string;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
};

const NAME_MAX = 50;

// Project Detail PRD 3장 (SCR-PD-08) — 프로젝트 이름 변경 중앙 모달 (Popup/input).
export function RenameProjectModal({ visible, currentName, onClose, onConfirm }: RenameProjectModalProps) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setName(currentName);
      opacity.setValue(0);
      scale.setValue(0.9);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, damping: 16, stiffness: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, currentName, opacity, scale]);

  const isValid = name.trim().length > 0 && name.trim().length <= NAME_MAX;

  async function handleConfirm() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      await onConfirm(name.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dim} accessibilityViewIsModal>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Text style={styles.title}>프로젝트 이름 변경</Text>
          <Text style={styles.description}>새로운 프로젝트 이름을 입력해주세요</Text>
          <TextInput
            value={name}
            onChangeText={(text) => setName(text.slice(0, NAME_MAX))}
            style={styles.input}
            autoFocus
            maxLength={NAME_MAX}
            editable={!saving}
          />
          <View style={styles.divider} />
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelLabel}>취소</Text>
            </Pressable>
            <View style={styles.buttonDivider} />
            <Pressable style={styles.confirmButton} onPress={handleConfirm} disabled={!isValid || saving}>
              {saving ? (
                <ActivityIndicator color={Brand.primary} size="small" />
              ) : (
                <Text style={[styles.confirmLabel, !isValid && styles.confirmLabelDisabled]}>변경</Text>
              )}
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
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 32,
    shadowOpacity: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.textPrimary,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: Brand.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  input: {
    fontSize: 15,
    color: Brand.textPrimary,
    borderBottomWidth: 1.5,
    borderBottomColor: Brand.primary,
    paddingVertical: 8,
    marginTop: 20,
  },
  divider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
    marginTop: 20,
    marginHorizontal: -20,
  },
  buttonRow: {
    flexDirection: 'row',
    height: 48,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.textDisabled,
  },
  buttonDivider: {
    width: 1,
    backgroundColor: Brand.borderDisabled,
  },
  confirmButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Brand.primary,
  },
  confirmLabelDisabled: {
    color: Brand.textDisabled,
  },
});
