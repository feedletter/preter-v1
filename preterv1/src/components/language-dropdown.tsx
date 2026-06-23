import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand } from '@/constants/theme';

const LANGUAGES = [
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'en', label: '영어 (English)', flag: '🇺🇸' },
  { code: 'ja', label: '일본어 (日本語)', flag: '🇯🇵' },
  { code: 'zh', label: '중국어 (中文)', flag: '🇨🇳' },
] as const;

export function LanguageDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = LANGUAGES.find((lang) => lang.code === value) ?? LANGUAGES[0];

  return (
    <View>
      <Text style={styles.label}>주 사용 언어 *</Text>
      <Pressable style={styles.field} onPress={() => setOpen((prev) => !prev)}>
        <Text style={styles.flag}>{selected.flag}</Text>
        <Text style={styles.value}>{selected.label}</Text>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      <Text style={styles.helperText}>통역에 사용할 기본 언어를 선택해주세요</Text>

      {open && (
        <View style={styles.options}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.code}
              style={styles.option}
              onPress={() => {
                onChange(lang.code);
                setOpen(false);
              }}>
              <Text style={styles.flag}>{lang.flag}</Text>
              <Text style={styles.optionLabel}>{lang.label}</Text>
              {lang.code === value && <Text style={styles.check}>✓</Text>}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textSecondary,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 40,
    marginTop: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: Brand.primary,
  },
  flag: {
    fontSize: 18,
  },
  value: {
    flex: 1,
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
  options: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: Brand.divider,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Brand.divider,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    color: Brand.textPrimary,
  },
  check: {
    fontSize: 16,
    color: Brand.primary,
  },
});
