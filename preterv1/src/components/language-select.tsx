import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Brand } from '@/constants/theme';

export type GuestLanguage = 'ko' | 'en' | 'ja' | 'zh';

const LANGUAGES: { code: GuestLanguage; label: string; flag: string }[] = [
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
];

type LanguageSelectProps = {
  value: GuestLanguage;
  onChange: (value: GuestLanguage) => void;
  disabled?: boolean;
};

export function LanguageSelect({ value, onChange, disabled }: LanguageSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = LANGUAGES.find((lang) => lang.code === value) ?? LANGUAGES[0];

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{t('languageSelect.label')}</Text>
        <View style={styles.requiredDot} />
      </View>
      <Pressable
        style={styles.field}
        disabled={disabled}
        onPress={() => setOpen(true)}>
        <Text style={styles.value}>
          {selected.label} {selected.flag}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      <Text style={styles.helperText}>{t('languageSelect.helper')}</Text>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            {LANGUAGES.map((lang) => (
              <Pressable
                key={lang.code}
                style={styles.option}
                onPress={() => {
                  onChange(lang.code);
                  setOpen(false);
                }}>
                <Text style={styles.optionLabel}>
                  {lang.label} {lang.flag}
                </Text>
                {lang.code === value && <Text style={styles.optionCheck}>✓</Text>}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textSecondary,
  },
  requiredDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Brand.requiredDot,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    marginTop: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: Brand.primary,
  },
  value: {
    fontSize: 16,
    color: Brand.textPrimary,
  },
  chevron: {
    fontSize: 14,
    color: Brand.primary,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 20,
    color: Brand.primary,
    marginTop: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 8,
    paddingBottom: 24,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  optionLabel: {
    fontSize: 16,
    color: Brand.textPrimary,
  },
  optionCheck: {
    fontSize: 16,
    color: Brand.primary,
    fontWeight: '700',
  },
});
