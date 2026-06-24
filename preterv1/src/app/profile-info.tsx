import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Spacing } from '@/constants/theme';

const LEGAL_LINKS = [
  { label: '이용약관', url: 'https://preter.me/terms' },
  { label: '개인정보 취급방침', url: 'https://preter.me/privacy' },
] as const;

// Profile PRD 7장 (SCR-P-07) — 이용약관/개인정보처리방침 등 법적고지 + 앱 버전 표시.
export default function ProfileInfoScreen() {
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const buildNumber =
    Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '100';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>정보</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.group}>
          {LEGAL_LINKS.map((item, index) => (
            <View key={item.label}>
              <Pressable
                style={styles.row}
                onPress={() => WebBrowser.openBrowserAsync(item.url)}
                accessibilityRole="button">
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.arrowIcon}>›</Text>
              </Pressable>
              {index < LEGAL_LINKS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
          <View style={styles.divider} />
          <Pressable
            style={styles.row}
            onPress={() => Alert.alert('오픈소스 라이선스는 준비 중이에요')}
            accessibilityRole="button">
            <Text style={styles.rowLabel}>오픈소스 라이선스</Text>
            <Text style={styles.arrowIcon}>›</Text>
          </Pressable>
        </View>

        <View style={styles.versionCard}>
          <Text style={styles.versionLabel}>앱 버전</Text>
          <Text style={styles.versionValue}>
            v{version} (Build {buildNumber})
          </Text>
        </View>
      </ScrollView>
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
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    gap: 16,
  },
  group: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
  },
  rowLabel: {
    fontSize: 16,
    color: Brand.textPrimary,
  },
  arrowIcon: {
    fontSize: 18,
    color: Brand.textDisabled,
  },
  divider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
  },
  versionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Brand.surfaceBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
  },
  versionLabel: {
    fontSize: 16,
    color: Brand.textPrimary,
  },
  versionValue: {
    fontSize: 14,
    color: Brand.textDisabled,
  },
});
