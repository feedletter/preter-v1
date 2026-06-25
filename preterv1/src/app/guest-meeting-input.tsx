import { AudioModule } from 'expo-audio';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CodeInput } from '@/components/code-input';
import { EarphoneCheckSheet } from '@/components/earphone-check-sheet';
import { GuestLanguage, LanguageSelect } from '@/components/language-select';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { GuestApiError, joinRoom, validateRoom } from '@/lib/guest';

const CODE_NOT_FOUND_MESSAGE = '존재하지 않는 미팅 코드예요. 코드를 다시 확인해주세요.';

type Step = 'code' | 'details';

export default function GuestMeetingInputScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  // Guest Live Session PRD 1.3 — validate 시점의 status로 입장 후 분기(즉시 라이브 vs 대기 화면).
  const [roomStatus, setRoomStatus] = useState<string>('active');

  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<GuestLanguage>('ko');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [passwordError, setPasswordError] = useState(false);

  const [requestingMic, setRequestingMic] = useState(false);
  const [showEarphoneSheet, setShowEarphoneSheet] = useState(false);
  const [joining, setJoining] = useState(false);

  // PRD 4.2 E1 + table29 P3: 시작 전 미팅은 모달 안내 후 카운트다운 표시, 도달 시 자동 재검증
  const [waitingForStart, setWaitingForStart] = useState<{ scheduledAt: string; secondsLeft: number } | null>(
    null,
  );

  useEffect(() => {
    if (!waitingForStart) return;
    if (waitingForStart.secondsLeft <= 0) {
      setWaitingForStart(null);
      handleConfirmJoin({ silent: true });
      return;
    }
    const timer = setTimeout(() => {
      setWaitingForStart((prev) =>
        prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : prev,
      );
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForStart]);

  function handleChangeCode(text: string) {
    setCode(text);
    setCodeError(false);
    if (text.length === 6) {
      handleValidate(text);
    }
  }

  function startCountdown(scheduledAt: string) {
    const secondsLeft = Math.max(
      0,
      Math.round((new Date(scheduledAt).getTime() - Date.now()) / 1000),
    );
    setWaitingForStart({ scheduledAt, secondsLeft });
  }

  async function handleValidate(roomCode: string) {
    setChecking(true);
    try {
      const result = await validateRoom(roomCode);
      setNeedsPassword(result.has_password);
      setRoomStatus(result.status);
      setStep('details');
    } catch (err) {
      if (err instanceof GuestApiError) {
        switch (err.code) {
          case 'ROOM_NOT_FOUND':
            setCodeError(true);
            break;
          case 'ROOM_ENDED':
          case 'ROOM_EXPIRED':
            // E2: 종료된 미팅
            Alert.alert('종료된 미팅이에요', '호스트가 미팅을 종료했어요.');
            break;
          case 'NETWORK_ERROR':
            Alert.alert('네트워크 연결을 확인해주세요');
            break;
          default:
            Alert.alert('미팅 코드를 확인할 수 없어요. 잠시 후 다시 시도해주세요.');
        }
      } else {
        Alert.alert('미팅 코드를 확인할 수 없어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setChecking(false);
    }
  }

  function handleBackToCode() {
    setStep('code');
    setCode('');
    setDisplayName('');
    setPassword('');
    setEmail('');
    setPasswordError(false);
    setWaitingForStart(null);
  }

  function formatCountdown(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`;
    if (minutes > 0) return `${minutes}분 ${seconds}초`;
    return `${seconds}초`;
  }

  const isDetailsValid = displayName.trim().length > 0 && (!needsPassword || password.length > 0);

  // PRD 4.4: 입장하기 탭 → 마이크 권한 체크 → 이어폰 확인 → 세션 진입
  async function handleSubmitDetails() {
    if (!isDetailsValid || requestingMic) return;
    setRequestingMic(true);
    try {
      const { granted, canAskAgain } = await AudioModule.requestRecordingPermissionsAsync();
      if (granted) {
        setAudioEnabled(true);
      } else {
        // SCR-G-06 거부 동작: 오디오 토글 Off로 청취 전용 모드 진입
        setAudioEnabled(false);
        if (!canAskAgain) {
          Alert.alert(
            '마이크 권한이 꺼져 있어요',
            '설정에서 마이크 권한을 허용하면 발화도 통역할 수 있어요. 지금은 청취 전용 모드로 참가해요.',
          );
        }
      }
      setShowEarphoneSheet(true);
    } finally {
      setRequestingMic(false);
    }
  }

  async function handleConfirmJoin(options?: { silent?: boolean }) {
    if (joining) return;
    setJoining(true);
    setPasswordError(false);
    try {
      const result = await joinRoom({
        room_code: code,
        display_name: displayName.trim(),
        password: needsPassword ? password : undefined,
        language,
        email: email.trim() || undefined,
        audio_enabled: audioEnabled,
      });
      setShowEarphoneSheet(false);
      router.replace({
        pathname: '/guest-live-session',
        params: {
          room_id: result.room_id,
          room_code: code,
          title: result.room_title ?? '미팅',
          status: roomStatus,
          my_name: displayName.trim(),
          my_language: language,
          password: needsPassword ? password : undefined,
        },
      });
    } catch (err) {
      if (err instanceof GuestApiError) {
        switch (err.code) {
          case 'WRONG_PASSWORD':
            setShowEarphoneSheet(false);
            setPasswordError(true);
            break;
          case 'ROOM_FULL':
            // E3: 정원 초과
            setShowEarphoneSheet(false);
            Alert.alert('미팅 정원이 가득 찼어요', '호스트에게 문의해주세요.');
            break;
          case 'ROOM_ENDED':
            setShowEarphoneSheet(false);
            Alert.alert('종료된 미팅이에요', '호스트가 미팅을 종료했어요.');
            handleBackToCode();
            break;
          case 'ROOM_NOT_STARTED': {
            // E1: 시작 전 미팅 — 카운트다운 후 자동 재시도, 시트는 유지
            const scheduledAt = (err.detail.scheduled_at as string) ?? null;
            if (!options?.silent) {
              Alert.alert('아직 시작되지 않은 미팅이에요', '시작 시간까지 자동으로 기다릴게요.');
            }
            if (scheduledAt) startCountdown(scheduledAt);
            break;
          }
          case 'NETWORK_ERROR':
            setShowEarphoneSheet(false);
            Alert.alert('네트워크 연결을 확인해주세요');
            break;
          default:
            setShowEarphoneSheet(false);
            Alert.alert('입장에 실패했어요. 잠시 후 다시 시도해주세요.');
        }
      } else {
        setShowEarphoneSheet(false);
        Alert.alert('입장에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setJoining(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (step === 'details' ? handleBackToCode() : router.back())}
          hitSlop={8}
          style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>미팅룸 참가</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'code' ? (
            <>
              <Text style={styles.headerTitle}>미팅룸 정보 입력</Text>
              <Text style={styles.headerSubtitle}>
                미팅룸 코드를 입력하고 참가자 정보를 입력해주세요
              </Text>

              <View style={styles.codeWrap}>
                <CodeInput
                  value={code}
                  onChangeText={handleChangeCode}
                  editable={!checking}
                  hasError={codeError}
                />
                {checking && <ActivityIndicator style={styles.codeSpinner} color={Brand.primary} />}
              </View>

              {codeError && <Text style={styles.helperError}>{CODE_NOT_FOUND_MESSAGE}</Text>}
            </>
          ) : (
            <>
              <Text style={styles.headerTitle}>미팅룸 정보 입력</Text>
              <Text style={styles.headerSubtitle}>미팅 코드 {code}</Text>

              <View style={styles.fields}>
                <TextField
                  label="사용자 이름"
                  required
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="미팅에서 표시될 이름을 입력해주세요"
                  returnKeyType="next"
                  editable={!joining}
                />

                <LanguageSelect value={language} onChange={setLanguage} disabled={joining} />

                <TextField
                  label="미팅룸 비밀번호"
                  required={needsPassword}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setPasswordError(false);
                  }}
                  placeholder="미팅 비밀번호를 입력해주세요 (선택)"
                  secureTextEntry
                  returnKeyType="next"
                  editable={!joining}
                  error={passwordError ? '비밀번호가 올바르지 않아요' : undefined}
                  helperText={
                    !passwordError
                      ? needsPassword
                        ? undefined
                        : '비밀번호가 없는 미팅이에요'
                      : undefined
                  }
                />

                <TextField
                  label="이메일 (선택)"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="jay@preter.me"
                  helperText="미팅 후 요약을 받을 이메일 주소를 입력해주세요"
                  keyboardType="email-address"
                  returnKeyType="done"
                  editable={!joining}
                />
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

              {!audioEnabled && (
                <Text style={styles.listenOnlyHint}>
                  오디오를 끄면 발화 없이 통역만 듣는 청취 전용 모드로 참가해요
                </Text>
              )}

              <Pressable
                onPress={handleSubmitDetails}
                disabled={!isDetailsValid || requestingMic}
                style={[styles.joinButton, !isDetailsValid && styles.joinButtonDisabled]}>
                {requestingMic ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.joinButtonLabel}>입장하기</Text>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <EarphoneCheckSheet
        visible={showEarphoneSheet}
        onConfirm={() => handleConfirmJoin()}
        onCancel={() => {
          setShowEarphoneSheet(false);
          setWaitingForStart(null);
        }}
        joining={joining}
        countdownText={
          waitingForStart
            ? `미팅 시작까지 ${formatCountdown(waitingForStart.secondsLeft)} 남았어요`
            : undefined
        }
      />
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
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Brand.textSecondary,
    marginTop: 4,
  },
  codeWrap: {
    marginTop: 32,
  },
  codeSpinner: {
    marginTop: 16,
  },
  helperError: {
    fontSize: 13,
    lineHeight: 20,
    color: Brand.error,
    textAlign: 'center',
    marginTop: 12,
  },
  fields: {
    marginTop: 24,
    gap: 24,
  },
  listenOnlyHint: {
    fontSize: 12,
    color: Brand.textSecondary,
    marginTop: 8,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 24,
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
  joinButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },
  joinButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  joinButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
});
