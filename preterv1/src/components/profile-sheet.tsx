import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as Updates from 'expo-updates';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditProfileSheet } from '@/components/edit-profile-sheet';
import { LanguageSettingSheet, ProfileLanguage } from '@/components/language-setting-sheet';
import { ReportIssueSheet } from '@/components/report-issue-sheet';
import { Brand } from '@/constants/theme';
import { logout } from '@/lib/auth';
import { setAppLanguage, SUPPORTED_APP_LANGUAGES } from '@/lib/i18n';
import { MyPlan, MyProfile, updateMyProfile } from '@/lib/users';

// 앱 서비스 언어는 실제 번역 리소스가 있는 언어만 선택 가능해야 한다 — 통역 언어용
// LanguageSettingSheet가 기본으로 보여주는 5개(ko/en/ja/zh/sg) 중 zh/sg를 고르면
// UI가 안 바뀌는 채로 DB값만 바뀌는 모순이 생기므로 SUPPORTED_APP_LANGUAGES로 제한한다.
const APP_LANGUAGE_OPTIONS = SUPPORTED_APP_LANGUAGES as ProfileLanguage[];

const HELP_CENTER_URL = 'https://docs.preter.me';
const SCREEN_WIDTH = Dimensions.get('window').width;

// OTA(EAS Update) 반영 확인용 한 줄. updateId/createdAt는 OTA가 적용된 실행에서만 채워지고,
// 새 OTA가 적용되면 값이 바뀐다 — createdAt(발행 시각)로 "최신 반영 여부"를 눈으로 확인한다.
function otaStatusLine(): string {
  if (!Updates.isEnabled) return 'OTA: dev';
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'OTA: 내장 번들 (미적용)';
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = Updates.createdAt;
  const when = d
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : '';
  return `OTA: ${when} · ${Updates.updateId.slice(0, 8)}`;
}
// 오른쪽 가장자리부터 끌어와서 닫는 제스처가 이 거리(화면 너비의 1/3)를 넘으면
// 손을 떼도 계속 닫히는 방향으로 완료시킨다 (그 이하면 원위치로 스냅백).
const CLOSE_DRAG_THRESHOLD = SCREEN_WIDTH / 3;

type ProfileSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 구독/정보 같은 풀스크린 페이지로 나갈 때 호출 — 돌아왔을 때 화면을 다시 열기 위함 */
  onNavigateAway: () => void;
  profile: MyProfile | null;
  plan: MyPlan | null;
  onProfileChange: (profile: MyProfile) => void;
};

type LanguageSheetTarget = 'primary_language' | 'app_language' | null;

// 프로필 화면을 바텀시트 위에 또 바텀시트(프로필 수정/언어/신고)를 띄우면 RN Modal이
// 동시에 2개 떠서(특히 Android) 두 번째 Modal이 안 보이거나 닫은 뒤 첫 Modal이 터치를
// 가로채는 문제가 있었다. 그래서 프로필 화면 자체는 Modal이 아닌 전면 화면 전환(우→좌
// 슬라이드)으로 바꾼다 — 자식 시트(EditProfileSheet 등)가 뜰 때도 Modal이 항상 최대
// 1개만 떠 있게 되어 구조적으로 해결된다.
export function ProfileSheet({
  visible,
  onClose,
  onNavigateAway,
  profile,
  plan,
  onProfileChange,
}: ProfileSheetProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [editVisible, setEditVisible] = useState(false);
  const [languageTarget, setLanguageTarget] = useState<LanguageSheetTarget>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateX.setValue(SCREEN_WIDTH);
      Animated.timing(translateX, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateX, {
        toValue: SCREEN_WIDTH,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, translateX]);

  const panResponder = useRef(
    PanResponder.create({
      // 좌→우로 끄는 제스처만 가로채고, 위아래 스크롤(ScrollView)은 그대로 둔다.
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dx > 0) translateX.setValue(gesture.dx);
      },
      onPanResponderRelease: (_, gesture) => {
        const shouldClose = gesture.dx > CLOSE_DRAG_THRESHOLD || gesture.vx > 0.8;
        if (shouldClose) {
          onClose();
          return;
        }
        Animated.timing(translateX, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  async function handleSaveName(name: string) {
    const updated = await updateMyProfile({ name });
    onProfileChange(updated);
    setEditVisible(false);
  }

  async function handleSelectLanguage(value: ProfileLanguage) {
    if (!languageTarget) return;
    const updated = await updateMyProfile({ [languageTarget]: value });
    onProfileChange(updated);
    // app_language(앱 UI 언어)를 바꾼 경우에만 즉시 i18n 전환 — primary_language(통역 언어)는
    // UI 표시 언어와 무관하니 건드리지 않는다.
    if (languageTarget === 'app_language') {
      setAppLanguage(updated.app_language);
    }
  }

  function handleLogout() {
    Alert.alert(t('profileSheet.logoutConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profileSheet.logout'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          onClose();
          router.replace('/welcome');
        },
      },
    ]);
  }

  async function handleOpenHelpCenter() {
    await WebBrowser.openBrowserAsync(HELP_CENTER_URL);
  }

  function handleOpenSubscription() {
    onNavigateAway();
    onClose();
    router.push({ pathname: '/subscription', params: { plan: plan?.plan ?? 'free' } });
  }

  function handleOpenInfo() {
    onNavigateAway();
    onClose();
    router.push('/profile-info');
  }

  if (!mounted) return null;

  const initial = (profile?.name ?? '?').trim().charAt(0) || '?';

  return (
    <>
      <Animated.View
        style={[styles.screen, { paddingTop: insets.top, transform: [{ translateX }] }]}
        {...panResponder.panHandlers}>
        <View style={styles.topRow}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t('profileSheet.close')} style={styles.closeButton}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.profileHeader}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <View style={styles.infoCol}>
            <Text style={styles.name}>{profile?.name ?? ''}</Text>
            <Text style={styles.email}>{profile?.email ?? ''}</Text>
            <Pressable onPress={() => setEditVisible(true)} hitSlop={4}>
              <Text style={styles.editLink}>{t('profileSheet.editProfile')}</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>{t('profileSheet.accountSection')}</Text>
          <View style={styles.group}>
            <Pressable
              style={styles.row}
              onPress={handleOpenSubscription}
              accessibilityRole="button"
              accessibilityHint={t('profileSheet.tapToChangeHint')}>
              <Text style={styles.rowLabel}>{t('profileSheet.subscriptionPlan')}</Text>
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>{(plan?.plan ?? 'free').toUpperCase()}</Text>
              </View>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('profileSheet.usage')}</Text>
              <Text style={styles.rowValue}>
                {plan ? t('profileSheet.usageThisMonth', { minutes: plan.minutes_used }) : ''}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>{t('profileSheet.languageSection')}</Text>
          <View style={styles.group}>
            <Pressable
              style={styles.row}
              onPress={() => setLanguageTarget('primary_language')}
              accessibilityRole="button"
              accessibilityHint={t('profileSheet.tapToChangeHint')}>
              <Text style={styles.rowLabel}>{t('profileSheet.interpretationLanguage')}</Text>
              <Text style={styles.rowValue}>{languageLabel(profile?.primary_language)}</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={styles.row}
              onPress={() => setLanguageTarget('app_language')}
              accessibilityRole="button"
              accessibilityHint={t('profileSheet.tapToChangeHint')}>
              <Text style={styles.rowLabel}>{t('profileSheet.appLanguage')}</Text>
              <Text style={styles.rowValue}>{languageLabel(profile?.app_language)}</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>{t('profileSheet.helpSection')}</Text>
          <View style={styles.group}>
            <Pressable style={styles.row} onPress={handleOpenHelpCenter} accessibilityRole="button">
              <Text style={styles.rowLabel}>{t('profileSheet.helpCenter')}</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={styles.row}
              onPress={() => setReportVisible(true)}
              accessibilityRole="button">
              <Text style={styles.rowLabel}>{t('profileSheet.reportIssue')}</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable style={styles.row} onPress={handleOpenInfo} accessibilityRole="button">
              <Text style={styles.rowLabel}>{t('profileSheet.info')}</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
          </View>

          <Pressable style={styles.logoutRow} onPress={handleLogout} accessibilityLabel={t('profileSheet.logout')}>
            <Text style={styles.logoutLabel}>{t('profileSheet.logout')}</Text>
          </Pressable>
          <Text style={styles.versionText}>Preter v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          <Text style={styles.otaText}>{otaStatusLine()}</Text>
        </ScrollView>
      </Animated.View>

      <EditProfileSheet
        visible={editVisible}
        currentName={profile?.name ?? ''}
        email={profile?.email ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        onSave={handleSaveName}
        onAvatarUpdated={onProfileChange}
        onClose={() => setEditVisible(false)}
      />

      <LanguageSettingSheet
        visible={languageTarget !== null}
        title={languageTarget === 'app_language' ? t('profileSheet.appLanguage') : t('profileSheet.interpretationLanguage')}
        description={
          languageTarget === 'app_language'
            ? t('profileSheet.appLanguageDescription')
            : t('profileSheet.interpretationLanguageDescription')
        }
        value={
          ((languageTarget === 'app_language' ? profile?.app_language : profile?.primary_language) ??
            'ko') as ProfileLanguage
        }
        onSelect={handleSelectLanguage}
        onClose={() => setLanguageTarget(null)}
        languageOptions={languageTarget === 'app_language' ? APP_LANGUAGE_OPTIONS : undefined}
      />

      <ReportIssueSheet visible={reportVisible} onClose={() => setReportVisible(false)} />
    </>
  );
}

function languageLabel(code: string | undefined): string {
  switch (code) {
    case 'en':
      return 'English';
    case 'ja':
      return '日本語';
    case 'zh':
      return '中文';
    case 'sg':
      return '싱가포르 영어';
    default:
      return '한국어';
  }
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    paddingHorizontal: 24,
    elevation: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    height: 32,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    fontSize: 20,
    color: Brand.textPrimary,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    height: 84,
    marginTop: 8,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#E8EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '700',
    color: Brand.primary,
  },
  infoCol: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  email: {
    fontSize: 13,
    color: Brand.textSecondary,
  },
  editLink: {
    fontSize: 12,
    color: Brand.primary,
  },
  scrollContent: {
    flex: 1,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textDisabled,
    marginTop: 16,
    marginBottom: 12,
  },
  group: {
    backgroundColor: 'white',
    borderRadius: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    gap: 8,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: Brand.textPrimary,
  },
  rowValue: {
    fontSize: 14,
    color: Brand.textSecondary,
  },
  arrowIcon: {
    fontSize: 18,
    color: Brand.textDisabled,
  },
  divider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
  },
  planBadge: {
    backgroundColor: '#E8EBFF',
    borderRadius: 10,
    paddingHorizontal: 8,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Brand.primary,
  },
  logoutRow: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  logoutLabel: {
    fontSize: 14,
    color: '#FF334B',
  },
  versionText: {
    fontSize: 12,
    color: Brand.textDisabled,
    textAlign: 'center',
    marginBottom: 4,
  },
  otaText: {
    fontSize: 11,
    color: Brand.textDisabled,
    textAlign: 'center',
    marginBottom: 24,
  },
});
