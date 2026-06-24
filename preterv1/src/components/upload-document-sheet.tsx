import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';
import { Document, uploadDocument } from '@/lib/documents';

type UploadDocumentSheetProps = {
  visible: boolean;
  onClose: () => void;
  onUploaded: (document: Document) => void;
};

const TITLE_MAX = 50;

// LeftSide PRD P2 — "새 미팅 자료" 플로팅 버튼 동작. 별도 화면 명세가 없어
// 기존 CreateProjectSheet과 같은 패턴(BottomSheet 재사용)으로 단순화.
export function UploadDocumentSheet({ visible, onClose, onUploaded }: UploadDocumentSheetProps) {
  const [title, setTitle] = useState('');
  const [pickedFile, setPickedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setPickedFile(null);
    }
  }, [visible]);

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'image/jpeg',
        'image/png',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPickedFile(asset);
    if (!title.trim()) setTitle(asset.name.replace(/\.[^/.]+$/, '').slice(0, TITLE_MAX));
  }

  const isValid = title.trim().length > 0 && !!pickedFile;

  async function handleConfirm() {
    if (!isValid || !pickedFile || uploading) return;
    setUploading(true);
    try {
      const document = await uploadDocument(
        title.trim(),
        pickedFile.uri,
        pickedFile.name,
        pickedFile.mimeType ?? 'application/octet-stream',
      );
      onUploaded(document);
      onClose();
    } catch {
      Alert.alert('자료 업로드에 실패했어요. 다시 시도해주세요');
    } finally {
      setUploading(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>미팅 자료 추가</Text>
        <Pressable
          onPress={handleConfirm}
          disabled={!isValid || uploading}
          style={[styles.confirmButton, !isValid && styles.confirmButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel="미팅 자료 추가 확인">
          {uploading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.confirmIcon}>✓</Text>}
        </Pressable>
      </View>

      <Pressable style={styles.filePicker} onPress={handlePickFile} disabled={uploading}>
        <Text style={styles.filePickerIcon}>📎</Text>
        <Text style={styles.filePickerLabel} numberOfLines={1}>
          {pickedFile ? pickedFile.name : '파일 선택하기 (PDF, Word, Excel, PPT, 이미지)'}
        </Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.label}>자료 제목</Text>
        <TextInput
          value={title}
          onChangeText={(text) => setTitle(text.slice(0, TITLE_MAX))}
          placeholder="자료 제목"
          placeholderTextColor={Brand.textDisabled}
          style={styles.nameInput}
          maxLength={TITLE_MAX}
          editable={!uploading}
        />
        <Text style={styles.counter}>
          {title.length}/{TITLE_MAX}
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 360,
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
  filePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Brand.surfaceBackground,
  },
  filePickerIcon: {
    fontSize: 16,
  },
  filePickerLabel: {
    flex: 1,
    fontSize: 14,
    color: Brand.textPrimary,
  },
  field: {
    marginTop: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Brand.textPrimary,
    marginBottom: 8,
  },
  nameInput: {
    fontSize: 16,
    color: Brand.textPrimary,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
  },
  counter: {
    fontSize: 11,
    color: Brand.textDisabled,
    textAlign: 'right',
    marginTop: 4,
  },
});
