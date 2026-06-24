import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Brand } from '@/constants/theme';

export type ProfileLanguage = 'ko' | 'en' | 'ja' | 'zh' | 'sg';

const LANGUAGES: { code: ProfileLanguage; label: string; flag: string }[] = [
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'sg', label: '싱가포르 영어', flag: '🇸🇬' },
];

type LanguageSettingSheetProps = {
  visible: boolean;
  title: string;
  description: string;
  value: ProfileLanguage;
  onSelect: (value: ProfileLanguage) => void;
  onClose: () => void;
};

// Profile PRD 5.1/5.3: 통역 언어(SCR-P-04)와 앱 서비스 언어(SCR-P-05)가 같은 하프 바텀시트를 공유한다.
export function LanguageSettingSheet({
  visible,
  title,
  description,
  value,
  onSelect,
  onClose,
}: LanguageSettingSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
          <Text style={styles.closeIcon}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.description}>{description}</Text>

      <View style={styles.list}>
        {LANGUAGES.map((lang) => {
          const selected = lang.code === value;
          return (
            <Pressable
              key={lang.code}
              style={[styles.row, selected && styles.rowSelected]}
              onPress={() => onSelect(lang.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}>
              <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>
                {lang.label} {lang.flag}
              </Text>
              {selected && <Text style={styles.checkMark}>✓</Text>}
            </Pressable>
          );
        })}
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
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -12,
  },
  closeIcon: {
    fontSize: 18,
    color: Brand.textSecondary,
  },
  description: {
    fontSize: 13,
    color: Brand.textSecondary,
    marginTop: 8,
  },
  list: {
    marginTop: 20,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  rowSelected: {
    backgroundColor: '#E8EBFF',
  },
  rowLabel: {
    fontSize: 16,
    color: Brand.textPrimary,
  },
  rowLabelSelected: {
    color: Brand.primary,
    fontWeight: '700',
  },
  checkMark: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.primary,
  },
});
