import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { TextField } from '@/components/text-field';
import { Brand } from '@/constants/theme';
import { deleteMyAvatar, MyProfile, uploadMyAvatar } from '@/lib/users';

type EditProfileSheetProps = {
  visible: boolean;
  currentName: string;
  email: string | null;
  avatarUrl: string | null;
  onSave: (name: string) => Promise<void>;
  onAvatarUpdated: (profile: MyProfile) => void;
  onClose: () => void;
};

// Profile PRD 3장 (SCR-P-02) — Profile Sheet 위에 겹쳐 뜨는 두 번째 바텀시트.
export function EditProfileSheet({
  visible,
  currentName,
  email,
  avatarUrl,
  onSave,
  onAvatarUpdated,
  onClose,
}: EditProfileSheetProps) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (visible) setName(currentName);
  }, [visible, currentName]);

  const isValid = name.trim().length > 0 && name.length <= 20;
  const isDirty = name !== currentName;

  function handleClose() {
    if (isDirty) {
      Alert.alert('변경사항을 저장하지 않고 닫을까요?', undefined, [
        { text: '취소', style: 'cancel' },
        { text: '닫기', style: 'destructive', onPress: onClose },
      ]);
      return;
    }
    onClose();
  }

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      await onSave(name.trim());
    } catch {
      Alert.alert('프로필 수정에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  }

  // PRD 9.4: 클라이언트에서 최대 512x512px로 리사이즈 후 업로드.
  async function processAndUpload(uri: string) {
    setAvatarBusy(true);
    try {
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      const updated = await uploadMyAvatar(resized.uri, 'image/jpeg');
      onAvatarUpdated(updated);
    } catch {
      Alert.alert('프로필 사진 업로드에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('카메라 권한이 필요해요', '설정에서 카메라 접근을 허용해주세요.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: true });
    if (result.canceled || !result.assets[0]) return;
    await processAndUpload(result.assets[0].uri);
  }

  async function handlePickFromGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('사진 라이브러리 권한이 필요해요', '설정에서 사진 접근을 허용해주세요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets[0]) return;
    await processAndUpload(result.assets[0].uri);
  }

  async function handleRemoveAvatar() {
    if (avatarBusy) return;
    setAvatarBusy(true);
    try {
      const updated = await deleteMyAvatar();
      onAvatarUpdated(updated);
    } catch {
      Alert.alert('프로필 사진 삭제에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose} sheetStyle={styles.sheet}>
      <Text style={styles.title}>프로필 수정</Text>

      <View style={styles.avatarSection}>
        <View style={styles.avatarWrap}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{(currentName || '?').charAt(0)}</Text>
            </View>
          )}
          {avatarBusy && (
            <View style={styles.avatarLoading}>
              <ActivityIndicator color="white" />
            </View>
          )}
          <View style={styles.cameraBadge}>
            <Text style={styles.cameraBadgeIcon}>📷</Text>
          </View>
        </View>

        <View style={styles.avatarActions}>
          <Pressable
            style={styles.avatarActionButton}
            onPress={handleTakePhoto}
            disabled={avatarBusy}>
            <Text style={styles.avatarActionLabel}>📷 새 사진 찍기</Text>
          </Pressable>
          <Pressable
            style={styles.avatarActionButton}
            onPress={handlePickFromGallery}
            disabled={avatarBusy}>
            <Text style={styles.avatarActionLabel}>🖼 갤러리에서 선택</Text>
          </Pressable>
          {avatarUrl && (
            <Pressable onPress={handleRemoveAvatar} disabled={avatarBusy} hitSlop={8}>
              <Text style={styles.removeLink}>현재 사진 제거</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.fields}>
        <TextField
          label="이름"
          required
          value={name}
          onChangeText={setName}
          placeholder="이름을 입력해주세요"
          helperText="미팅에서 표시될 이름이에요"
          editable={!saving}
        />

        <View style={styles.emailField}>
          <View style={styles.emailLabelRow}>
            <Text style={styles.emailLabel}>이메일</Text>
            <View style={styles.emailBadge}>
              <Text style={styles.emailBadgeText}>변경 불가</Text>
            </View>
          </View>
          <Text style={styles.emailValue}>{email}</Text>
        </View>
      </View>

      <Pressable
        onPress={handleSave}
        disabled={!isValid || saving}
        style={[styles.saveButton, !isValid && styles.saveButtonDisabled]}>
        {saving ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.saveButtonLabel}>저장하기</Text>
        )}
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 420,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
    marginTop: 8,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 20,
  },
  avatarWrap: {
    width: 80,
    height: 80,
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Brand.surfaceBackground,
  },
  avatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E8EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 28,
    fontWeight: '700',
    color: Brand.primary,
  },
  avatarLoading: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  cameraBadgeIcon: {
    fontSize: 12,
  },
  avatarActions: {
    flex: 1,
    gap: 8,
  },
  avatarActionButton: {
    paddingVertical: 8,
  },
  avatarActionLabel: {
    fontSize: 14,
    color: Brand.textPrimary,
  },
  removeLink: {
    fontSize: 13,
    color: '#FF334B',
  },
  fields: {
    marginTop: 24,
    gap: 24,
  },
  emailField: {
    width: '100%',
  },
  emailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  emailLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textSecondary,
  },
  emailBadge: {
    backgroundColor: Brand.borderDisabled,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  emailBadgeText: {
    fontSize: 10,
    color: Brand.textSecondary,
  },
  emailValue: {
    fontSize: 16,
    color: Brand.textDisabled,
    marginTop: 12,
    paddingBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
  },
  saveButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },
  saveButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  saveButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
});
