import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';
import { createProject, Project } from '@/lib/projects';

type CreateProjectSheetProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
};

const NAME_MAX = 50;
const DESCRIPTION_MAX = 200;

// LeftSide PRD 6장 (SCR-L-05/06) — 프로젝트 생성 바텀시트.
export function CreateProjectSheet({ visible, onClose, onCreated }: CreateProjectSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setDescription('');
    }
  }, [visible]);

  const isValid = name.trim().length > 0;

  async function handleConfirm() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const project = await createProject(name.trim(), description.trim());
      onCreated(project);
      onClose();
    } catch {
      Alert.alert(t('createProjectSheet.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('createProjectSheet.title')}</Text>
        <Pressable
          onPress={handleConfirm}
          disabled={!isValid || saving}
          style={[styles.confirmButton, !isValid && styles.confirmButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('createProjectSheet.confirmAccessibilityLabel')}>
          {saving ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.confirmIcon}>✓</Text>}
        </Pressable>
      </View>
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
        />
        <Text style={styles.counter}>{name.length}/{NAME_MAX}</Text>
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
        />
        <Text style={styles.counter}>{description.length}/{DESCRIPTION_MAX}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 420,
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
    minHeight: 80,
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
