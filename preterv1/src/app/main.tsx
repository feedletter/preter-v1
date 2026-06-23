import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Spacing } from '@/constants/theme';

type Tab = 'create' | 'join';

// 미팅 생성/참가 기능은 다음 단계에서 연동. 현재는 Figma 디자인만 반영.
export default function MainScreen() {
  const [tab, setTab] = useState<Tab>('create');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <View style={styles.topNav}>
        <Pressable hitSlop={8}>
          <Image
            source={require('@/assets/images/main/menu-icon.png')}
            style={styles.menuIcon}
            contentFit="contain"
          />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Image
          source={require('@/assets/images/main/logo-icon.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={styles.heroText}>동시통역 미팅이{'\n'}필요하신가요?</Text>
      </View>

      <View style={styles.panel}>
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, tab === 'create' && styles.tabActive]}
            onPress={() => setTab('create')}>
            <Text style={[styles.tabLabel, tab === 'create' && styles.tabLabelActive]}>
              미팅 생성
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === 'join' && styles.tabActive]}
            onPress={() => setTab('join')}>
            <Text style={[styles.tabLabel, tab === 'join' && styles.tabLabelActive]}>
              미팅 참가
            </Text>
          </Pressable>
        </View>

        <View style={styles.optionCard}>
          <View style={styles.optionRow}>
            <Text style={styles.optionLabel}>나의 언어</Text>
            <View style={styles.optionValue}>
              <Text style={styles.optionValueText}>한국어</Text>
              <Image
                source={require('@/assets/images/main/chevron-icon.png')}
                style={styles.chevronIcon}
                contentFit="contain"
              />
            </View>
          </View>
          <View style={styles.optionRow}>
            <Text style={styles.optionLabel}>미팅 자료</Text>
            <View style={styles.optionValue}>
              <Text style={styles.optionValueTextMuted}>설정 없음</Text>
              <Image
                source={require('@/assets/images/main/chevron-icon.png')}
                style={styles.chevronIcon}
                contentFit="contain"
              />
            </View>
          </View>
        </View>

        <Pressable style={styles.startButton}>
          <Image
            source={require('@/assets/images/main/mic-icon.png')}
            style={styles.micIcon}
            contentFit="contain"
          />
          <Text style={styles.startButtonLabel}>시작하기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  topNav: {
    paddingHorizontal: Spacing.three + 4,
    paddingTop: 12,
  },
  menuIcon: {
    width: 24,
    height: 24,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  logo: {
    width: 38,
    height: 38,
  },
  heroText: {
    marginTop: 16,
    fontSize: 16,
    color: Brand.textPrimary,
    textAlign: 'center',
    lineHeight: 24,
  },
  panel: {
    margin: 20,
    padding: 16,
    borderRadius: 20,
    backgroundColor: Brand.surfaceBackground,
    gap: 12,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 100,
    height: 47,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
  },
  tabActive: {
    backgroundColor: Brand.primary,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: Brand.textDisabled,
  },
  tabLabelActive: {
    fontWeight: '700',
    color: 'white',
  },
  optionCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 16,
    gap: 20,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionLabel: {
    fontSize: 14,
    color: Brand.textDisabled,
  },
  optionValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionValueText: {
    fontSize: 14,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  optionValueTextMuted: {
    fontSize: 14,
    fontWeight: '700',
    color: Brand.textDisabled,
  },
  chevronIcon: {
    width: 14,
    height: 14,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 8,
    backgroundColor: Brand.primary,
  },
  micIcon: {
    width: 20,
    height: 20,
  },
  startButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
});
