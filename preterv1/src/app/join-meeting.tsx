import { AudioModule } from 'expo-audio';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { CodeInput } from '@/components/code-input';
import { DocumentSelectSheet } from '@/components/document-select-sheet';
import { JoinMeetingSheet } from '@/components/join-meeting-sheet';
import { ProjectSelectSheet } from '@/components/project-select-sheet';
import { Brand, Spacing } from '@/constants/theme';
import { Document } from '@/lib/documents';
import { Project } from '@/lib/projects';
import { joinRoomMember, registerParticipant, RoomsApiError, validateRoomMember } from '@/lib/rooms';
import { getMyProfile } from '@/lib/users';

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Member Join MeetingRoom PRD v1.0.0 — 로그인 멤버가 코드로 기존 미팅에 참가하는 화면 (SCR-J-01~04).
// 폼 골격/바텀시트/이어폰 확인은 ★ Create Meeting PRD와 완전 동일 컴포넌트를 재사용한다.
export default function JoinMeetingScreen() {
  const router = useRouter();

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
        setCodeError('존재하지 않는 미팅 코드예요');
      } else if (err instanceof RoomsApiError && err.code === 'ROOM_EXPIRED') {
        setCodeError('이미 종료된 미팅이에요');
      } else {
        setCodeError('미팅 코드를 확인할 수 없어요. 잠시 후 다시 시도해주세요');
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
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) setAudioEnabled(false);
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

      if (result.status === 'waiting') {
        setEarphoneSheetVisible(false);
        const label = result.scheduled_at ? formatDateLabel(result.scheduled_at) : '';
        router.replace({
          pathname: '/main',
          params: { reservationSnackbar: encodeURIComponent(`미팅에 참가 등록됐어요! ${label}`) },
        });
        return;
      }

      await registerParticipant(result.room_id, { role: 'member', language, audio_enabled: audioEnabled });
      setEarphoneSheetVisible(false);
      router.replace({
        pathname: '/join-live-session',
        params: {
          room_id: result.room_id,
          room_code: code,
          title: result.title ?? roomTitle ?? '미팅',
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
            Alert.alert('미팅 정원이 가득 찼어요', '호스트에게 문의해주세요.');
            break;
          case 'ROOM_EXPIRED':
            Alert.alert('이미 종료된 미팅이에요', undefined, [
              { text: '확인', onPress: () => handleChangeCode('') },
            ]);
            break;
          default:
            Alert.alert('참가에 실패했어요. 잠시 후 다시 시도해주세요');
        }
      } else {
        Alert.alert('참가에 실패했어요. 잠시 후 다시 시도해주세요');
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
        <Text style={styles.topBarTitle}>미팅룸 참가</Text>
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.headerTitle}>미팅룸 정보 입력</Text>
            <Text style={styles.headerSubtitle}>미팅룸 코드를 입력하고 참가자 정보를 입력해주세요</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>채팅방 코드 *</Text>
            <View style={styles.codeWrap}>
              <CodeInput value={code} onChangeText={handleChangeCode} editable={!checking} hasError={!!codeError} />
              {checking && <ActivityIndicator style={styles.codeSpinner} color={Brand.primary} />}
            </View>
            <Text style={[styles.helperText, codeError ? styles.helperTextError : styles.helperTextAccent]}>
              {codeError ?? '숫자 6자리 채팅방 코드를 입력해주세요'}
            </Text>
          </View>

          <Pressable style={styles.dropdownField} onPress={() => setProjectSheetVisible(true)}>
            <Text style={styles.label}>프로젝트 선택</Text>
            <View style={styles.dropdownTextArea}>
              <Text style={[styles.dropdownValue, !project && styles.placeholderText]} numberOfLines={1}>
                {project?.name ?? '프로젝트를 선택해주세요 (선택)'}
              </Text>
              <Text style={styles.dropdownArrow}>▾</Text>
            </View>
            <Text style={styles.helperTextAccent}>선택한 프로젝트의 지시사항과 자료가 통역에 자동 반영돼요</Text>
          </Pressable>

          <Pressable style={styles.dropdownField} onPress={() => setDocumentSheetVisible(true)}>
            <Text style={styles.label}>미팅 자료 선택</Text>
            <View style={styles.dropdownTextArea}>
              <Text style={[styles.dropdownValue, !document && styles.placeholderText]} numberOfLines={1}>
                {document?.title ?? '자료를 선택해주세요 (선택)'}
              </Text>
              <Text style={styles.dropdownArrow}>▾</Text>
            </View>
            <Text style={styles.helperTextAccent}>자료를 선택하면 AI가 내용을 참고하며 통역해요</Text>
          </Pressable>

          <View style={styles.field}>
            <Text style={styles.label}>채팅방 비밀번호 {needsPassword ? '*' : '(선택)'}</Text>
            <View style={styles.textArea}>
              <TextInput
                value={password}
                onChangeText={(text) => {
                  setPassword(text.replace(/[^0-9]/g, '').slice(0, 8));
                  setPasswordError(false);
                }}
                placeholder="채팅방 비밀번호"
                placeholderTextColor={Brand.textDisabled}
                style={styles.input}
                keyboardType="number-pad"
                secureTextEntry
                editable={!joining}
              />
            </View>
            <Text style={[styles.helperText, passwordError && styles.helperTextError]}>
              {passwordError
                ? '비밀번호가 올바르지 않아요'
                : password.length > 0 && !passwordValid
                  ? '숫자 4자리 이상 입력해주세요'
                  : '미팅 비밀번호를 입력해주세요 (선택)'}
            </Text>
          </View>

          <View style={styles.audioRow}>
            <View style={styles.audioText}>
              <Text style={styles.audioLabel}>오디오 연결</Text>
              <Text style={styles.audioSublabel}>마이크와 스피커를 활성화해요</Text>
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
                미팅 참가하기
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
        confirmLabel="미팅 참가하기"
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
