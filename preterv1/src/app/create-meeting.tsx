import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { DocumentSelectSheet } from '@/components/document-select-sheet';
import { JoinMeetingSheet } from '@/components/join-meeting-sheet';
import { ProjectSelectSheet } from '@/components/project-select-sheet';
import { Brand, Spacing } from '@/constants/theme';
import { Document } from '@/lib/documents';
import { logEvent } from '@/lib/firebase';
import i18n from '@/lib/i18n';
import { consumePendingCreatedProject, Project } from '@/lib/projects';
import { cancelDraftRoom, createDraftRoom, createRoom, startRoom } from '@/lib/rooms';

const TITLE_MAX = 50;

function nextRoundedHour(base: Date): Date {
  const next = new Date(base);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function formatRoomCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

function formatDateField(date: Date): string {
  return i18n.t('main.dateLabel', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

function formatTimeField(date: Date): string {
  const hour24 = date.getHours();
  const period = hour24 < 12 ? i18n.t('createMeeting.am') : i18n.t('createMeeting.pm');
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${period} ${hour12}:${minute}`;
}

function combineDate(time: Date, datePart: Date): Date {
  const next = new Date(time);
  next.setFullYear(datePart.getFullYear(), datePart.getMonth(), datePart.getDate());
  return next;
}

function combineTime(time: Date, timePart: Date): Date {
  const next = new Date(time);
  next.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
  return next;
}

// Create Meeting PRD v1.0.0 — Member Create MeetingRoom 화면 (SCR-C-01~07).
export default function CreateMeetingScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const [draftId, setDraftId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState<Date>(() => nextRoundedHour(new Date()));
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [password, setPassword] = useState('');

  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [projectSheetVisible, setProjectSheetVisible] = useState(false);
  const [documentSheetVisible, setDocumentSheetVisible] = useState(false);

  const [creating, setCreating] = useState(false);
  const [joinSheetVisible, setJoinSheetVisible] = useState(false);
  const [joining, setJoining] = useState(false);
  const confirmedRoom = useRef<{ id: string; room_code: string; title: string } | null>(null);

  useEffect(() => {
    createDraftRoom()
      .then((draft) => {
        setDraftId(draft.id);
        setRoomCode(draft.room_code);
      })
      .catch(() => Alert.alert(t('createMeeting.draftFailed'), '', [
        { text: t('createMeeting.confirm'), onPress: () => router.back() },
      ]))
      .finally(() => setDraftLoading(false));
  }, [router]);

  // create-project 페이지에서 생성하고 돌아오면 새 프로젝트를 바로 선택 상태로 반영한다.
  useFocusEffect(
    useCallback(() => {
      const pending = consumePendingCreatedProject();
      if (pending) setProject(pending);
    }, []),
  );

  const titleValid = title.trim().length > 0;
  const passwordValid = password.length === 0 || password.length >= 4;
  const formValid = titleValid && passwordValid;

  const handleBack = useCallback(() => {
    if (title.trim().length > 0) {
      Alert.alert(t('createMeeting.cancelConfirm'), undefined, [
        { text: t('createMeeting.keepEditing'), style: 'cancel' },
        {
          text: t('createMeeting.exit'),
          style: 'destructive',
          onPress: () => {
            if (draftId) cancelDraftRoom(draftId);
            router.back();
          },
        },
      ]);
    } else {
      if (draftId) cancelDraftRoom(draftId);
      router.back();
    }
  }, [title, draftId, router]);

  function handleDateTimeChange(event: DateTimePickerEvent, selected: Date | undefined) {
    if (Platform.OS === 'android') setPickerMode(null);
    if (event.type === 'dismissed' || !selected) return;
    setScheduledAt((prev) => (pickerMode === 'date' ? combineDate(prev, selected) : combineTime(prev, selected)));
  }

  async function handleCreate() {
    if (!formValid || creating || !draftId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCreating(true);
    try {
      const result = await createRoom({
        draft_id: draftId,
        title: title.trim(),
        scheduled_at: scheduledAt.toISOString(),
        project_id: project?.id ?? null,
        document_id: document?.id ?? null,
        password: password || undefined,
      });

      const isReservation = new Date(result.scheduled_at).getTime() > Date.now();
      logEvent('meeting_create', { room_id: result.id, is_reservation: isReservation });
      if (isReservation) {
        const label = `${formatDateField(scheduledAt)} ${formatTimeField(scheduledAt)}`;
        router.replace({
          pathname: '/main',
          params: {
            reservationSnackbar: encodeURIComponent(t('createMeeting.reservedSnackbar', { label })),
            refreshMeetings: '1',
          },
        });
      } else {
        confirmedRoom.current = { id: result.id, room_code: result.room_code, title: result.title };
        setJoinSheetVisible(true);
      }
    } catch {
      Alert.alert(t('createMeeting.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  // 호스트 플로우엔 원래 마이크 권한 요청이 없었다 — join-meeting/guest-meeting-input과
  // 달리 한 번도 권한을 안 받은 채로 live-audio-bridge가 playAndRecord 세션을 활성화하려
  // 시도해서 크래시가 났다(2026-06-27 TestFlight build 17). 이미 허용된 경우 팝업 없이
  // 바로 넘어가도록 check 먼저 하고, 미정 상태일 때만 요청 팝업을 띄운다.
  async function ensureMicPermission(): Promise<boolean> {
    const current = await AudioManager.checkRecordingPermissions();
    if (current === 'Granted') return true;
    if (current === 'Denied') {
      Alert.alert(
        t('createMeeting.micPermissionDeniedTitle'),
        t('createMeeting.micPermissionDeniedBody'),
      );
      return false;
    }
    const requested = await AudioManager.requestRecordingPermissions();
    return requested === 'Granted';
  }

  async function handleJoinConfirm() {
    if (joining || !confirmedRoom.current) return;
    setJoining(true);
    try {
      await ensureMicPermission();
      await startRoom(confirmedRoom.current.id);
      logEvent('meeting_start', { room_id: confirmedRoom.current.id });
      router.replace({
        pathname: '/host-live-session',
        params: {
          room_id: confirmedRoom.current.id,
          room_code: confirmedRoom.current.room_code,
          title: confirmedRoom.current.title,
          started: '1',
        },
      });
    } catch {
      Alert.alert(t('createMeeting.startFailedTitle'), t('createMeeting.startFailedBody'));
    } finally {
      setJoining(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable onPress={handleBack} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <View style={styles.topBarTitleRow}>
          {!!roomCode && <Text style={styles.codeAccentSmall}>{formatRoomCode(roomCode)}</Text>}
          <Text style={styles.topBarTitle}>{t('createMeeting.topBarTitle')}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {draftLoading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator color={Brand.primary} />
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                  {!!roomCode && <Text style={styles.codeAccent}>{formatRoomCode(roomCode)}</Text>}
                  <Text style={styles.headerTitle}>{t('createMeeting.headerTitle')}</Text>
                </View>
                <Text style={styles.headerSubtitle}>{t('createMeeting.headerSubtitle')}</Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t('createMeeting.titleLabel')}</Text>
                <View style={[styles.textArea, styles.textAreaActive]}>
                  <TextInput
                    value={title}
                    onChangeText={(text) => setTitle(text.slice(0, TITLE_MAX))}
                    placeholder={t('createMeeting.titlePlaceholder')}
                    placeholderTextColor={Brand.textDisabled}
                    style={styles.input}
                    editable={!creating}
                  />
                  {title.length > 0 && (
                    <Pressable onPress={() => setTitle('')} hitSlop={8}>
                      <Text style={styles.clearIcon}>⊗</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={styles.helperText}>{t('createMeeting.titleHelper')}</Text>
              </View>

              <View style={styles.dateTimeRow}>
                <Pressable style={styles.dateTimeField} onPress={() => setPickerMode('date')}>
                  <Text style={styles.label}>{t('createMeeting.dateLabel')}</Text>
                  <View style={[styles.textArea, styles.textAreaActive]}>
                    <Text style={styles.input}>{formatDateField(scheduledAt)}</Text>
                  </View>
                </Pressable>
                <Pressable style={styles.dateTimeField} onPress={() => setPickerMode('time')}>
                  <Text style={styles.label}>{t('createMeeting.timeLabel')}</Text>
                  <View style={[styles.textArea, styles.textAreaActive]}>
                    <Text style={styles.input}>{formatTimeField(scheduledAt)}</Text>
                  </View>
                </Pressable>
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
                <Text style={styles.helperTextAccent}>{t('createMeeting.documentHelper')}</Text>
              </Pressable>

              <View style={styles.field}>
                <Text style={styles.label}>{t('createMeeting.passwordLabel')}</Text>
                <View style={styles.textArea}>
                  <TextInput
                    value={password}
                    onChangeText={(text) => setPassword(text.replace(/[^0-9]/g, '').slice(0, 8))}
                    placeholder={t('createMeeting.passwordPlaceholder')}
                    placeholderTextColor={Brand.textDisabled}
                    style={styles.input}
                    keyboardType="number-pad"
                    secureTextEntry
                    editable={!creating}
                  />
                </View>
                <Text style={styles.helperText}>
                  {password.length > 0 && !passwordValid ? t('createMeeting.passwordTooShort') : t('createMeeting.passwordHelper')}
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.btnSection}>
          <Pressable
            onPress={handleCreate}
            disabled={!formValid || creating || draftLoading}
            style={[styles.primaryButton, (!formValid || draftLoading) && styles.primaryButtonDisabled]}>
            {creating ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={[styles.primaryButtonLabel, (!formValid || draftLoading) && styles.primaryButtonLabelDisabled]}>
                {t('createMeeting.createButton')}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {Platform.OS === 'ios' ? (
        <BottomSheet visible={pickerMode !== null} onClose={() => setPickerMode(null)} sheetStyle={styles.pickerSheet}>
          <DateTimePicker
            value={scheduledAt}
            mode={pickerMode ?? 'date'}
            display="spinner"
            themeVariant="light"
            textColor={Brand.textPrimary}
            onChange={handleDateTimeChange}
          />
          <Pressable style={styles.pickerDoneButton} onPress={() => setPickerMode(null)}>
            <Text style={styles.pickerDoneButtonLabel}>{t('createMeeting.done')}</Text>
          </Pressable>
        </BottomSheet>
      ) : (
        pickerMode !== null && (
          <DateTimePicker value={scheduledAt} mode={pickerMode} display="default" onChange={handleDateTimeChange} />
        )
      )}

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
        visible={joinSheetVisible}
        joining={joining}
        onConfirm={handleJoinConfirm}
        onClose={() => setJoinSheetVisible(false)}
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
    backgroundColor: Brand.surfaceBackground,
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
  topBarTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeAccentSmall: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.primary,
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
  centerLoading: {
    paddingTop: Spacing.six,
    alignItems: 'center',
  },
  header: {
    gap: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeAccent: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.primary,
  },
  headerTitle: {
    flex: 1,
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
  textArea: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
  },
  textAreaActive: {
    borderBottomWidth: 1.5,
    borderBottomColor: Brand.primary,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Brand.textPrimary,
    padding: 0,
  },
  clearIcon: {
    fontSize: 18,
    color: Brand.textDisabled,
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
  dateTimeRow: {
    flexDirection: 'row',
    gap: 20,
  },
  dateTimeField: {
    flex: 1,
    gap: 6,
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
  pickerSheet: {
    alignItems: 'center',
  },
  pickerDoneButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 52,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  pickerDoneButtonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
  },
});
