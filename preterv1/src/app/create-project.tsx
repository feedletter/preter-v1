import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Brand, Spacing } from '@/constants/theme';
import { createProject, setPendingCreatedProject } from '@/lib/projects';

const NAME_MAX = 50;
const DESCRIPTION_MAX = 200;

// Create Meeting PRD 4.5 / LeftSide PRD 6장 (SCR-L-05/06) — 프로젝트 생성 전용 페이지.
// 미팅 생성 폼의 바텀시트 위에 또 다른 모달을 띄우면 Android에서 터치가 먹지 않는 문제가 있어
// 별도 화면으로 분리했다 (생성 완료 시 pendingCreatedProject에 담아 이전 화면에서 자동 선택).
export default function CreateProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const isValid = name.trim().length > 0;

  async function handleConfirm() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const project = await createProject(name.trim(), description.trim());
      setPendingCreatedProject(project);
      router.back();
    } catch {
      Alert.alert(t('createProjectSheet.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{t('createProjectSheet.title')}</Text>
        <Pressable
          onPress={handleConfirm}
          disabled={!isValid || saving}
          style={styles.confirmButton}
          accessibilityRole="button"
          accessibilityLabel={t('createProjectSheet.confirmAccessibilityLabel')}>
          {saving ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={[styles.confirmIcon, !isValid && styles.confirmIconDisabled]}>✓</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.guideText}>{t('createProjectSheet.guideText')}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('createProjectSheet.nameQuestion')}</Text>
            <TextInput
              value={name}
              onChangeText={(text) => setName(text.slice(0, NAME_MAX))}
              placeholder={t('createProjectSheet.namePlaceholder')}
              placeholderTextColor={Brand.textDisabled}
              style={styles.nameInput}
              maxLength={NAME_MAX}
              editable={!saving}
            />
            <Text style={styles.counter}>
              {name.length}/{NAME_MAX}
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('createProjectSheet.descriptionQuestion')}</Text>
            <TextInput
              value={description}
              onChangeText={(text) => setDescription(text.slice(0, DESCRIPTION_MAX))}
              placeholder={t('createProjectSheet.descriptionPlaceholder')}
              placeholderTextColor={Brand.textDisabled}
              style={styles.descriptionInput}
              multiline
              maxLength={DESCRIPTION_MAX}
              editable={!saving}
            />
            <Text style={styles.counter}>
              {description.length}/{DESCRIPTION_MAX}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  confirmButton: {
    position: 'absolute',
    right: 20,
    top: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
  confirmIconDisabled: {
    color: 'rgba(255,255,255,0.6)',
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
  },
  guideText: {
    fontSize: 13,
    color: Brand.textSecondary,
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
  descriptionInput: {
    fontSize: 14,
    color: Brand.textPrimary,
    minHeight: 100,
    textAlignVertical: 'top',
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
