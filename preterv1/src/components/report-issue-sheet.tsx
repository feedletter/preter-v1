import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type Category = 'audio' | 'connection' | 'ui' | 'other';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'audio', label: '음성/통역' },
  { value: 'connection', label: '연결 오류' },
  { value: 'ui', label: 'UI 버그' },
  { value: 'other', label: '기타' },
];

type ReportIssueSheetProps = {
  visible: boolean;
  onClose: () => void;
};

// Profile PRD 6장 (SCR-P-06) — 앱 문제 신고하기 하프 바텀시트.
export function ReportIssueSheet({ visible, onClose }: ReportIssueSheetProps) {
  const [category, setCategory] = useState<Category>('audio');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isValid = body.trim().length >= 10 && body.length <= 500;

  function handleClose() {
    setBody('');
    setCategory('audio');
    onClose();
  }

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const accessToken = await SecureStore.getItemAsync('access_token');
      const response = await fetch(`${API_URL}/api/v1/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          category,
          body: body.trim(),
          device_info: { platform: Platform.OS, os_version: String(Platform.Version) },
          app_version: Constants.expoConfig?.version ?? 'unknown',
        }),
      });
      if (!response.ok) throw new Error('submit failed');

      Alert.alert('신고가 접수되었어요. 빠르게 확인할게요 💙');
      handleClose();
    } catch {
      Alert.alert('신고 접수에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose} sheetStyle={styles.sheet}>
      <Text style={styles.title}>앱 문제 신고하기</Text>
      <Text style={styles.description}>
        발생한 문제를 자세히 설명해주세요. 빠르게 확인하고 개선할게요 🙏
      </Text>

      <View style={styles.chipRow}>
        {CATEGORIES.map((item) => {
          const selected = item.value === category;
          return (
            <Pressable
              key={item.value}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setCategory(item.value)}>
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          value={body}
          onChangeText={(text) => setBody(text.slice(0, 500))}
          placeholder="문제를 상세히 설명해주세요 (재현 방법, 기기 정보 등)"
          placeholderTextColor={Brand.textDisabled}
          multiline
          textAlignVertical="top"
          editable={!submitting}
        />
      </View>
      <Text style={styles.counter}>{body.length}/500</Text>

      <Pressable
        onPress={handleSubmit}
        disabled={!isValid || submitting}
        style={[styles.submitButton, !isValid && styles.submitButtonDisabled]}>
        {submitting ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.submitButtonLabel}>신고 제출하기</Text>
        )}
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 480,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
    marginTop: 8,
  },
  description: {
    fontSize: 13,
    color: Brand.textSecondary,
    marginTop: 8,
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 20,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Brand.border,
  },
  chipSelected: {
    backgroundColor: '#E8EBFF',
    borderColor: Brand.primary,
  },
  chipLabel: {
    fontSize: 13,
    color: Brand.textPrimary,
  },
  chipLabelSelected: {
    color: Brand.primary,
    fontWeight: '700',
  },
  inputArea: {
    height: 140,
    borderRadius: 12,
    backgroundColor: Brand.surfaceBackground,
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
    marginTop: 16,
    padding: 12,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: Brand.textPrimary,
  },
  counter: {
    fontSize: 12,
    color: Brand.textDisabled,
    textAlign: 'right',
    marginTop: 4,
  },
  submitButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  submitButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  submitButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
});
