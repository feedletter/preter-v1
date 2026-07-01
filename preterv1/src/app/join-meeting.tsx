import { AudioManager } from 'react-native-audio-api';
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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CodeInput } from '@/components/code-input';
import { DocumentSelectSheet } from '@/components/document-select-sheet';
import { JoinMeetingSheet } from '@/components/join-meeting-sheet';
import { ProjectSelectSheet } from '@/components/project-select-sheet';
import { Brand, Spacing } from '@/constants/theme';
import { Document } from '@/lib/documents';
import { logEvent } from '@/lib/firebase';
import { Project } from '@/lib/projects';
import i18n from '@/lib/i18n';
import { joinRoomMember, registerParticipant, RoomsApiError, validateRoomMember } from '@/lib/rooms';
import { getMyProfile } from '@/lib/users';

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const datePart = i18n.t('main.dateLabel', { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${datePart} ${time}`;
}

// Member Join MeetingRoom PRD v1.0.0 — 로그인 멤버가 코드로 기존 미팅에 참가하는 화면 (SCR-J-01~04).
// 폼 골격/바텀시트/이어폰 확인은 ★ Create Meeting PRD와 완전 동일 컴포넌트를 재사용한다.
export default function JoinMeetingScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomTitle, setRoomTitle] = useState<string | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [password, setPassword] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [passwordError, setPasswordError] = useState(false);

  const [projectSheetVisible, setProjectSheetVisible] = useState(false);
  const [documentSheetVisible, setDocumentSheetVisible] = useState(false);

  const [joining, setJoining] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [earphoneSheetVisible, setEarphoneSheetVisible] = useState(false);
  const [language, setLanguage] = useState('ko');

  const passwordValid = password.length === 0 || password.length >= 4;
  const codeValid = code.length === 6 && roomId !== null && !codeError;
  const formValid = codeValid && (!needsPassword || password.length >= 4);

  async function handleChangeCode(text: string) {
    setCode(text);
    setCodeError(null);
    setRoomId(null);
    if (text.length !== 6) return;

    setChecking(true);
    try {
      const result = await validateRoomMember(text);
      setNeedsPassword(result.has_password);
      setRoomId(result.room_id);
      setRoomTitle(result.title);
    } catch (err) {
      if (err instanceof RoomsApiError && err.code === 'ROOM_NOT_FOUND') {
        setCodeError(t('joinMeeting.codeNotFound'));
      } else if (err instanceof RoomsApiError && err.code === 'ROOM_EXPIRED') {
        setCodeError(t('joinMeeting.codeExpired'));
      } else {
        setCodeError(t('joinMeeting.validateFailed'));
      }
    } finally {
      setChecking(false);
    }
  }

  // PRD 2.5/3.4: 참가하기 탭 → 마이크 권한 체크 → 이어폰 확인 → 입장 분기.
  async function handleSubmit() {
    if (!formValid || requestingMic) return;
    setRequestingMic(true);
    try {
      const status = await AudioManager.requestRecordingPermissions();
      if (status !== 'Granted') {
        // guest-meeting-input.tsx와 동일한 거부 처리로 통일 — iOS는 한번 거부하면
        // 시스템 다이얼로그를 다시 띄우지 않으므로 'Denied'는 "다시 물어볼 수 없음"과
        // 동치로 취급해 안내 후 청취 전용 모드로 진행한다.
        setAudioEnabled(false);
        if (status === 'Denied') {
          Alert.alert(t('joinMeeting.micPermissionDeniedTitle'), t('joinMeeting.micPermissionDeniedBody'));
        }
      }
      try {
        const profile = await getMyProfile();
        setLanguage(profile.primary_language);
      } catch {
        // 프로필 조회 실패해도 기본 언어(ko)로 진행.
      }
      setEarphoneSheetVisible(true);
    } finally {
      setRequestingMic(false);
    }
  }

  async function handleConfirmJoin() {
    if (joining || !roomId) return;
    setJoining(true);
    setPasswordError(false);
    try {
      const result = await joinRoomMember(code, {
        project_id: project?.id ?? null,
        document_id: document?.id ?? null,
        password: needsPassword ? password : undefined,
        audio_enabled: audioEnabled,
      });

      // PRD 6.1 — 참가 등록(meeting_participants insert)은 status와 무관하게 항상 여기서
      // 해준다. waiting 상태에서도 등록을 안 해두면 /api/v1/meetings/upcoming의
      // member_room_ids 조회에 안 걸려서 메인 화면 "예약된 미팅" 목록에 영영 안 뜬다.
      await registerParticipant(result.room_id, { role: 'member', language, audio_enabled: audioEnabled });
      logEvent('meeting_join', { method: 'member', room_id: result.room_id });

      const scheduledPassed = result.scheduled_at
        ? new Date(result.scheduled_at).getTime() <= Date.now()
        : true;

      if (result.status === 'waiting' && !scheduledPassed) {
        // 시작 시간이 아직 안 됨 — 메인 화면 "예약된 미팅" 목록으로 안내.
        setEarphoneSheetVisible(false);
        const label = result.scheduled_at ? formatDateLabel(result.scheduled_at) : '';
        router.replace({
          pathname: '/main',
          params: {
            reservationSnackbar: encodeURIComponent(t('joinMeeting.registeredSnackbar', { label })),
            refreshMeetings: '1',
          },
        });
        return;
      }

      // status === 'active', 또는 status === 'waiting'이지만 예약 시간이 이미 지남
      // (호스트가 아직 시작 버튼을 안 누른 상태) — 두 경우 모두 미팅 페이지로 바로
      // 이동한다. join-live-session 화면이 status를 보고 대기 UI/실시간 UI를 자체 분기한다.
      setEarphoneSheetVisible(false);
      router.replace({
        pathname: '/join-live-session',
        params: {
          room_id: result.room_id,
          room_code: code,
          title: result.title ?? roomTitle ?? t('main.untitledMeeting'),
          status: result.status,
          password: needsPassword ? password : undefined,
        },
      });
    } catch (err) {
      setEarphoneSheetVisible(false);
      if (err instanceof RoomsApiError) {
        switch (err.code) {
          case 'WRONG_PASSWORD':
            setPasswordError(true);
            break;
          case 'ROOM_FULL':
            Alert.alert(t('joinMeeting.roomFullTitle'), t('joinMeeting.roomFullBody'));
            break;
          case 'ROOM_EXPIRED':
            Alert.alert(t('joinMeeting.codeExpired'), undefined, [
              { text: t('createMeeting.confirm'), onPress: () => handleChangeCode('') },
            ]);
            break;
          default:
            Alert.alert(t('joinMeeting.joinFailed'));
        }
      } else {
        Alert.alert(t('joinMeeting.joinFailed'));
      }
    } finally {
      setJoining(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{t('joinMeeting.topBarTitle')}</Text>
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('joinMeeting.headerTitle')}</Text>
            <Text style={styles.headerSubtitle}>{t('joinMeeting.headerSubtitle')}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('joinMeeting.codeLabel')}</Text>
            <View style={styles.codeWrap}>
              <CodeInput value={code} onChangeText={handleChangeCode} editable={!checking} hasError={!!codeError} />
              {checking && <ActivityIndicator style={styles.codeSpinner} color={Brand.primary} />}
            </View>
            <Text style={[styles.helperText, codeError ? styles.helperTextError : styles.helperTextAccent]}>
              {codeError ?? (codeValid ? t('joinMeeting.codeValid') : t('joinMeeting.codeHelper'))}
            </Text>
          </View>

          <Pressable style={styles.dropdownField} onPress={() => setProjectSheetVisible(true)}>
            <Text style={styles.label}>{t('createMeeting.projectLabel')}</Text>
            <View style={styles.dropdownTextArea}>
              <Text style={[styles.dropdownValue, !project && styles.placeholderText]} numberOfLines={1}>
                {project?.name ?? t('createMeeting.projectPlaceholder')}
              </Text>
              <Text style={styles.dropdownArrow}>▾</Text>
            </View>
            <Text style={styles.helperTextAccent}>{t('createMeeting.projectHelper')}</Text>
          </Pressable>

          <Pressable style={styles.dropdownField} onPress={() => setDocumentSheetVisible(true)}>
            <Text style={styles.label}>{t('createMeeting.documentLabel')}</Text>
            <View style={styles.dropdownTextArea}>
              <Text style={[styles.dropdownValue, !document && styles.placeholderText]} numberOfLines={1}>
                {document?.title ?? t('createMeeting.documentPlaceholder')}
              </Text>
              <Text style={styles.dropdownArrow}>▾</Text>
            </View>
            <Text style={styles.helperTextAccent}>{t('joinMeeting.documentHelper')}</Text>
          </Pressable>

          <View style={styles.field}>
            <Text style={styles.label}>
              {needsPassword ? t('joinMeeting.passwordLabelRequired') : t('joinMeeting.passwordLabelOptional')}
            </Text>
            <View style={styles.textArea}>
              <TextInput
                value={password}
                onChangeText={(text) => {
                  setPassword(text.replace(/[^0-9]/g, '').slice(0, 8));
                  setPasswordError(false);
                }}
                placeholder={t('joinMeeting.passwordPlaceholder')}
                placeholderTextColor={Brand.textDisabled}
                style={styles.input}
                keyboardType="number-pad"
                secureTextEntry
                editable={!joining}
              />
            </View>
            <Text style={[styles.helperText, passwordError && styles.helperTextError]}>
              {passwordError
                ? t('guestMeetingInput.passwordError')
                : password.length > 0 && !passwordValid
                  ? t('createMeeting.passwordTooShort')
                  : t('joinMeeting.passwordHelper')}
            </Text>
          </View>

          <View style={styles.audioRow}>
            <View style={styles.audioText}>
              <Text style={styles.audioLabel}>{t('guestMeetingInput.audioLabel')}</Text>
              <Text style={styles.audioSublabel}>{t('guestMeetingInput.audioSublabel')}</Text>
            </View>
            <Switch
              value={audioEnabled}
              onValueChange={setAudioEnabled}
              trackColor={{ true: '#06C755', false: Brand.borderDisabled }}
              disabled={joining}
              accessibilityRole="switch"
              accessibilityState={{ checked: audioEnabled }}
            />
          </View>
        </ScrollView>

        <View style={styles.btnSection}>
          <Pressable
            onPress={handleSubmit}
            disabled={!formValid || requestingMic}
            style={[styles.primaryButton, !formValid && styles.primaryButtonDisabled]}>
            {requestingMic ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={[styles.primaryButtonLabel, !formValid && styles.primaryButtonLabelDisabled]}>
                {t('joinMeeting.joinButton')}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ProjectSelectSheet
        visible={projectSheetVisible}
        selectedProjectId={project?.id ?? null}
        onClose={() => setProjectSheetVisible(false)}
        onApply={setProject}
      />

      <DocumentSelectSheet
        visible={documentSheetVisible}
        selectedDocumentId={document?.id ?? null}
        onClose={() => setDocumentSheetVisible(false)}
        onApply={setDocument}
      />

      <JoinMeetingSheet
        visible={earphoneSheetVisible}
        joining={joining}
        confirmLabel={t('joinMeeting.joinButton')}
        onConfirm={handleConfirmJoin}
        onClose={() => setEarphoneSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.surfaceBackground,
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
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.three + 4,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  header: {
    gap: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Brand.textSecondary,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Brand.textSecondary,
  },
  codeWrap: {
    marginTop: 4,
  },
  codeSpinner: {
    marginTop: 12,
  },
  textArea: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Brand.textPrimary,
    padding: 0,
  },
  helperText: {
    fontSize: 13,
    color: Brand.textDisabled,
    paddingTop: 8,
  },
  helperTextAccent: {
    fontSize: 13,
    color: Brand.primary,
    paddingTop: 8,
  },
  helperTextError: {
    color: Brand.error,
  },
  dropdownField: {
    gap: 0,
  },
  dropdownTextArea: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderBottomWidth: 1.5,
    borderBottomColor: Brand.primary,
  },
  dropdownValue: {
    flex: 1,
    fontSize: 14,
    color: Brand.textPrimary,
  },
  placeholderText: {
    color: Brand.textDisabled,
  },
  dropdownArrow: {
    fontSize: 14,
    color: Brand.primary,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  audioText: {
    gap: 2,
  },
  audioLabel: {
    fontSize: 15,
    color: Brand.textPrimary,
  },
  audioSublabel: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  btnSection: {
    backgroundColor: Brand.surfaceBackground,
    paddingHorizontal: Spacing.three + 4,
    paddingVertical: 10,
  },
  primaryButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  primaryButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
  primaryButtonLabelDisabled: {
    color: Brand.textDisabled,
  },
});
