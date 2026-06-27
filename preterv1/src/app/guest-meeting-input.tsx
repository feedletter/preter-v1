import { AudioManager } from 'react-native-audio-api';
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
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CodeInput } from '@/components/code-input';
import { EarphoneCheckSheet } from '@/components/earphone-check-sheet';
import { GuestLanguage, LanguageSelect } from '@/components/language-select';
import { TextField } from '@/components/text-field';
import { Brand, Spacing } from '@/constants/theme';
import { logEvent } from '@/lib/firebase';
import { GuestApiError, joinRoom, validateRoom } from '@/lib/guest';

type Step = 'code' | 'details';

export default function GuestMeetingInputScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const CODE_NOT_FOUND_MESSAGE = t('guestMeetingInput.codeNotFound');
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
            Alert.alert(t('guestMeetingInput.roomEndedTitle'), t('guestMeetingInput.roomEndedBody'));
            break;
          case 'NETWORK_ERROR':
            Alert.alert(t('common.networkError'));
            break;
          default:
            Alert.alert(t('guestMeetingInput.validateFailed'));
        }
      } else {
        Alert.alert(t('guestMeetingInput.validateFailed'));
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
      const status = await AudioManager.requestRecordingPermissions();
      if (status === 'Granted') {
        setAudioEnabled(true);
      } else {
        // SCR-G-06 거부 동작: 오디오 토글 Off로 청취 전용 모드 진입
        // iOS는 권한을 한번 거부하면 시스템 다이얼로그를 다시 띄우지 않으므로,
        // 'Denied'는 곧 "다시 물어볼 수 없음(canAskAgain=false)"과 동치로 취급한다.
        setAudioEnabled(false);
        if (status === 'Denied') {
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
      logEvent('meeting_join', { method: 'guest', room_id: result.room_id });
      setShowEarphoneSheet(false);
      router.replace({
        pathname: '/guest-live-session',
        params: {
          room_id: result.room_id,
          room_code: code,
          title: result.room_title ?? t('main.untitledMeeting'),
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
            Alert.alert(t('guestMeetingInput.roomFullTitle'), t('guestMeetingInput.roomFullBody'));
            break;
          case 'ROOM_ENDED':
            setShowEarphoneSheet(false);
            Alert.alert(t('guestMeetingInput.roomEndedTitle'), t('guestMeetingInput.roomEndedBody'));
            handleBackToCode();
            break;
          case 'ROOM_NOT_STARTED': {
            // E1: 시작 전 미팅 — 카운트다운 후 자동 재시도, 시트는 유지
            const scheduledAt = (err.detail.scheduled_at as string) ?? null;
            if (!options?.silent) {
              Alert.alert(t('guestMeetingInput.roomNotStartedTitle'), t('guestMeetingInput.roomNotStartedBody'));
            }
            if (scheduledAt) startCountdown(scheduledAt);
            break;
          }
          case 'NETWORK_ERROR':
            setShowEarphoneSheet(false);
            Alert.alert(t('common.networkError'));
            break;
          default:
            setShowEarphoneSheet(false);
            Alert.alert(t('guestMeetingInput.joinFailed'));
        }
      } else {
        setShowEarphoneSheet(false);
        Alert.alert(t('guestMeetingInput.joinFailed'));
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
        <Text style={styles.topBarTitle}>{t('guestMeetingInput.topBarTitle')}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'code' ? (
            <>
              <Text style={styles.headerTitle}>{t('guestMeetingInput.headerTitle')}</Text>
              <Text style={styles.headerSubtitle}>{t('guestMeetingInput.codeStepSubtitle')}</Text>

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
              <Text style={styles.headerTitle}>{t('guestMeetingInput.headerTitle')}</Text>
              <Text style={styles.headerSubtitle}>{t('guestMeetingInput.headerSubtitle', { code })}</Text>

              <View style={styles.fields}>
                <TextField
                  label={t('guestMeetingInput.nameLabel')}
                  required
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder={t('guestMeetingInput.namePlaceholder')}
                  returnKeyType="next"
                  editable={!joining}
                />

                <LanguageSelect value={language} onChange={setLanguage} disabled={joining} />

                <TextField
                  label={t('guestMeetingInput.passwordLabel')}
                  required={needsPassword}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setPasswordError(false);
                  }}
                  placeholder={t('guestMeetingInput.passwordPlaceholder')}
                  secureTextEntry
                  returnKeyType="next"
                  editable={!joining}
                  error={passwordError ? t('guestMeetingInput.passwordError') : undefined}
                  helperText={
                    !passwordError
                      ? needsPassword
                        ? undefined
                        : t('guestMeetingInput.noPasswordHelper')
                      : undefined
                  }
                />

                <TextField
                  label={t('guestMeetingInput.emailLabel')}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="jay@preter.me"
                  helperText={t('guestMeetingInput.emailHelper')}
                  keyboardType="email-address"
                  returnKeyType="done"
                  editable={!joining}
                />
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

              {!audioEnabled && (
                <Text style={styles.listenOnlyHint}>{t('guestMeetingInput.listenOnlyHint')}</Text>
              )}

              <Pressable
                onPress={handleSubmitDetails}
                disabled={!isDetailsValid || requestingMic}
                style={[styles.joinButton, !isDetailsValid && styles.joinButtonDisabled]}>
                {requestingMic ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.joinButtonLabel}>{t('guestMeetingInput.joinButton')}</Text>
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
            ? t('guestMeetingInput.countdownText', { time: formatCountdown(waitingForStart.secondsLeft) })
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
