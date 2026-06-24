import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { EditProfileSheet } from '@/components/edit-profile-sheet';
import { LanguageSettingSheet, ProfileLanguage } from '@/components/language-setting-sheet';
import { ReportIssueSheet } from '@/components/report-issue-sheet';
import { Brand } from '@/constants/theme';
import { logout } from '@/lib/auth';
import { getMyPlan, getMyProfile, MyPlan, MyProfile, updateMyProfile } from '@/lib/users';

const HELP_CENTER_URL = 'https://docs.preter.me';

type ProfileSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** 구독/정보 같은 풀스크린 페이지로 나갈 때 호출 — 돌아왔을 때 시트를 다시 열기 위함 */
  onNavigateAway: () => void;
};

type LanguageSheetTarget = 'primary_language' | 'app_language' | null;

export function ProfileSheet({ visible, onClose, onNavigateAway }: ProfileSheetProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [languageTarget, setLanguageTarget] = useState<LanguageSheetTarget>(null);
  const [reportVisible, setReportVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    getMyProfile().then(setProfile).catch(() => {});
    getMyPlan().then(setPlan).catch(() => {});
  }, [visible]);

  async function handleSaveName(name: string) {
    const updated = await updateMyProfile({ name });
    setProfile(updated);
    setEditVisible(false);
  }

  async function handleSelectLanguage(value: ProfileLanguage) {
    if (!languageTarget) return;
    const updated = await updateMyProfile({ [languageTarget]: value });
    setProfile(updated);
  }

  function handleLogout() {
    Alert.alert('로그아웃하시겠어요?', undefined, [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
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

  const initial = (profile?.name ?? '?').trim().charAt(0) || '?';

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
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
              <Text style={styles.editLink}>프로필 수정 →</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>계정</Text>
          <View style={styles.group}>
            <Pressable
              style={styles.row}
              onPress={handleOpenSubscription}
              accessibilityRole="button"
              accessibilityHint="탭하면 설정을 변경합니다">
              <Text style={styles.rowLabel}>구독 플랜</Text>
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>{(plan?.plan ?? 'free').toUpperCase()}</Text>
              </View>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>사용량</Text>
              <Text style={styles.rowValue}>
                {plan ? `이번 달 ${plan.minutes_used}분 사용` : ''}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>언어 설정</Text>
          <View style={styles.group}>
            <Pressable
              style={styles.row}
              onPress={() => setLanguageTarget('primary_language')}
              accessibilityRole="button"
              accessibilityHint="탭하면 설정을 변경합니다">
              <Text style={styles.rowLabel}>프리터 통역 언어</Text>
              <Text style={styles.rowValue}>{languageLabel(profile?.primary_language)}</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={styles.row}
              onPress={() => setLanguageTarget('app_language')}
              accessibilityRole="button"
              accessibilityHint="탭하면 설정을 변경합니다">
              <Text style={styles.rowLabel}>앱 서비스 언어</Text>
              <Text style={styles.rowValue}>{languageLabel(profile?.app_language)}</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>도움말</Text>
          <View style={styles.group}>
            <Pressable style={styles.row} onPress={handleOpenHelpCenter} accessibilityRole="button">
              <Text style={styles.rowLabel}>도움말 센터</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={styles.row}
              onPress={() => setReportVisible(true)}
              accessibilityRole="button">
              <Text style={styles.rowLabel}>앱 문제 신고하기</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable style={styles.row} onPress={handleOpenInfo} accessibilityRole="button">
              <Text style={styles.rowLabel}>정보</Text>
              <Text style={styles.arrowIcon}>›</Text>
            </Pressable>
          </View>

          <Pressable style={styles.logoutRow} onPress={handleLogout} accessibilityLabel="로그아웃">
            <Text style={styles.logoutLabel}>로그아웃</Text>
          </Pressable>
          <Text style={styles.versionText}>Preter v1.0.0</Text>
        </ScrollView>
      </BottomSheet>

      <EditProfileSheet
        visible={editVisible}
        currentName={profile?.name ?? ''}
        email={profile?.email ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        onSave={handleSaveName}
        onAvatarUpdated={setProfile}
        onClose={() => setEditVisible(false)}
      />

      <LanguageSettingSheet
        visible={languageTarget !== null}
        title={languageTarget === 'app_language' ? '앱 서비스 언어' : '프리터 통역 언어'}
        description={
          languageTarget === 'app_language'
            ? '앱 서비스에 사용할 기본 언어를 선택해주세요'
            : '미팅 세션에서 사용할 기본 언어를 선택해주세요'
        }
        value={
          ((languageTarget === 'app_language' ? profile?.app_language : profile?.primary_language) ??
            'ko') as ProfileLanguage
        }
        onSelect={handleSelectLanguage}
        onClose={() => setLanguageTarget(null)}
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
  sheet: {
    height: '92%',
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    height: 100,
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
    marginBottom: 24,
  },
});
