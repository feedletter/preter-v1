import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';
import { saveProjectInstructions } from '@/lib/projects';

type ProjectInstructionsSheetProps = {
  visible: boolean;
  projectId: string;
  currentContent: string | null;
  onClose: () => void;
  onSaved: (content: string | null) => void;
};

const CONTENT_MAX = 500;

// Project Detail PRD 6장 (SCR-PD-06/07) — 지시사항 바텀시트.
export function ProjectInstructionsSheet({
  visible,
  projectId,
  currentContent,
  onClose,
  onSaved,
}: ProjectInstructionsSheetProps) {
  const [content, setContent] = useState(currentContent ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setContent(currentContent ?? '');
  }, [visible, currentContent]);

  async function handleSave() {
    if (saving) return;
    const trimmed = content.trim();

    // PRD 6.4: 빈값으로 저장 시 지시사항 삭제 처리 (confirm Alert 표시).
    if (!trimmed && currentContent) {
      Alert.alert('지시사항을 삭제하시겠어요?', undefined, [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => doSave('') },
      ]);
      return;
    }
    if (!trimmed) {
      onClose();
      return;
    }
    await doSave(trimmed);
  }

  async function doSave(value: string) {
    setSaving(true);
    try {
      await saveProjectInstructions(projectId, value);
      onSaved(value || null);
      onClose();
    } catch {
      Alert.alert('저장에 실패했어요. 다시 시도해주세요');
    } finally {
      setSaving(false);
    }
  }

  const isValid = content.trim().length > 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>지시사항</Text>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.confirmButton, !isValid && !currentContent && styles.confirmButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel="지시사항 저장">
          {saving ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.confirmIcon}>✓</Text>}
        </Pressable>
      </View>
      <Text style={styles.guideText}>
        미팅 통역 중 AI가 이 내용을 참고해요{'\n'}프로젝트 내 모든 미팅에 적용됩니다
      </Text>

      <View style={styles.textAreaWrap}>
        <TextInput
          value={content}
          onChangeText={(text) => setContent(text.slice(0, CONTENT_MAX))}
          placeholder={
            '통역 시 참고할 지시사항을 입력해주세요\n예시:\n• 상대방은 가격보다 납기를 중시합니다\n• 기술 용어는 영문 그대로 유지해주세요\n• 공손하고 격식체로 통역해주세요'
          }
          placeholderTextColor={Brand.textDisabled}
          style={styles.textArea}
          multiline
          maxLength={CONTENT_MAX}
          textAlignVertical="top"
          editable={!saving}
        />
      </View>
      <Text style={styles.counter}>{content.length}자</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 432,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  confirmButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  confirmIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
  guideText: {
    fontSize: 13,
    color: Brand.textSecondary,
    marginTop: 12,
    lineHeight: 18,
  },
  textAreaWrap: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
    backgroundColor: Brand.surfaceBackground,
  },
  textArea: {
    minHeight: 200,
    maxHeight: 240,
    padding: 14,
    fontSize: 14,
    color: Brand.textPrimary,
    lineHeight: 20,
  },
  counter: {
    fontSize: 12,
    color: Brand.textSecondary,
    textAlign: 'right',
    marginTop: 6,
  },
});
