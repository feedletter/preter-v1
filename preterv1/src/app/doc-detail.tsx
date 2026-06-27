import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { DeleteProjectModal } from '@/components/delete-project-modal';
import { DocumentContextSheet } from '@/components/document-context-sheet';
import { RenameProjectModal } from '@/components/rename-project-modal';
import { Brand } from '@/constants/theme';
import {
  deleteDocument,
  DocumentDetail,
  DocumentMessage,
  fetchDocumentDetail,
  fetchDocumentMessages,
  pollMessageStatus,
  sendFileMessage,
  sendTextMessage,
  updateDocumentTitle,
} from '@/lib/documents';
import i18n from '@/lib/i18n';

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Figma "date-sep" — "2026년 6월 15일" (zero-padding 없음).
function formatKoreanDate(iso: string): string {
  const d = new Date(iso);
  return i18n.t('docDetail.dateLabel', { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

function formatUploadDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function bubbleLabel(type: DocumentMessage['type']): { icon: string; label: string } {
  return type === 'file'
    ? { icon: '📎', label: i18n.t('docDetail.bubblePdf') }
    : { icon: '📝', label: i18n.t('docDetail.bubbleText') };
}

// Figma "ai-bubble" title-row — 자료 유형에 따라 맥락 저장 완료 메시지가 다름.
function aiCardCopy(type: DocumentMessage['type']): { title: string; description: string } {
  return type === 'file'
    ? {
        title: i18n.t('docDetail.aiFileTitle'),
        description: i18n.t('docDetail.aiFileDescription'),
      }
    : {
        title: i18n.t('docDetail.aiTextTitle'),
        description: i18n.t('docDetail.aiTextDescription'),
      };
}

async function pollUntilDone(documentId: string, messageId: string, onUpdate: (msg: Partial<DocumentMessage>) => void) {
  const maxAttempts = 15; // 2초 * 15 = 30초
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const result = await pollMessageStatus(documentId, messageId);
      if (result.status !== 'processing') {
        onUpdate(result);
        return;
      }
    } catch {
      onUpdate({ status: 'failed' });
      return;
    }
  }
  onUpdate({ status: 'failed' });
}

export default function DocDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { document_id } = useLocalSearchParams<{ document_id: string }>();

  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [messages, setMessages] = useState<DocumentMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const [menuVisible, setMenuVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [contextSheetVisible, setContextSheetVisible] = useState(false);

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!document_id) return;
    try {
      const [detailResult, messagesResult] = await Promise.all([
        fetchDocumentDetail(document_id),
        fetchDocumentMessages(document_id),
      ]);
      setDetail(detailResult);
      setMessages(messagesResult);
    } catch {
      Alert.alert(t('docDetail.loadFailed'));
    }
  }, [document_id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  function updateMessage(id: string, patch: Partial<DocumentMessage>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setDetail((prev) =>
      prev ? { ...prev, context_count: prev.context_count + (patch.status === 'completed' ? 1 : 0) } : prev,
    );
  }

  async function handleSendText() {
    if (!document_id || sending) return;
    const text = inputText.trim();
    if (!text) return;

    setSending(true);
    setInputText('');
    try {
      const message = await sendTextMessage(document_id, text);
      setMessages((prev) => [...prev, message]);
      setDetail((prev) => (prev ? { ...prev, message_count: prev.message_count + 1 } : prev));
      scrollRef.current?.scrollToEnd({ animated: true });
      pollUntilDone(document_id, message.id, (patch) => updateMessage(message.id, patch));
    } catch {
      Alert.alert(t('docDetail.sendTextFailed'));
    } finally {
      setSending(false);
    }
  }

  async function handleSendFile(uri: string, name: string, mimeType: string) {
    if (!document_id) return;
    setSending(true);
    try {
      const message = await sendFileMessage(document_id, uri, name, mimeType);
      setMessages((prev) => [...prev, message]);
      setDetail((prev) => (prev ? { ...prev, message_count: prev.message_count + 1 } : prev));
      scrollRef.current?.scrollToEnd({ animated: true });
      pollUntilDone(document_id, message.id, (patch) => updateMessage(message.id, patch));
    } catch {
      Alert.alert(t('docDetail.sendFileFailed'));
    } finally {
      setSending(false);
    }
  }

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await handleSendFile(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream');
  }

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('docDetail.photoPermissionNeeded'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const filename = asset.fileName ?? `photo_${Date.now()}.jpg`;
    await handleSendFile(asset.uri, filename, asset.mimeType ?? 'image/jpeg');
  }

  function handlePressAttach() {
    Alert.alert(t('docDetail.attachTitle'), undefined, [
      { text: t('docDetail.attachFile'), onPress: handlePickFile },
      { text: t('docDetail.attachPhoto'), onPress: handlePickPhoto },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  async function handleRename(name: string) {
    if (!document_id) return;
    try {
      await updateDocumentTitle(document_id, name);
      setDetail((prev) => (prev ? { ...prev, title: name } : prev));
      setRenameVisible(false);
    } catch {
      Alert.alert(t('docDetail.renameFailed'));
    }
  }

  async function handleDelete() {
    if (!document_id) return;
    try {
      await deleteDocument(document_id);
      setDeleteVisible(false);
      router.back();
    } catch {
      Alert.alert(t('docDetail.deleteFailed'));
    }
  }

  // Doc Detail PRD — 학습 배지: 첫 분석 완료(context_count > 0) 전엔 "학습 전", 이후 "학습 완료".
  const isLearned = (detail?.context_count ?? 0) > 0;
  const fileCount = messages.filter((m) => m.type === 'file').length;
  const textCount = messages.filter((m) => m.type === 'text').length;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('docDetail.back')}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {detail?.title ?? ''}
        </Text>
        <Pressable
          onPress={() => setMenuVisible((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('docDetail.optionsMenu')}>
          <Text style={styles.moreIcon}>⋯</Text>
        </Pressable>
      </View>

      {menuVisible && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={styles.menu}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setRenameVisible(true);
              }}>
              <Text style={styles.menuItemLabel}>{t('docDetail.renameMenu')}</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setDeleteVisible(true);
              }}>
              <Text style={[styles.menuItemLabel, styles.menuItemDanger]}>{t('docDetail.deleteMenu')}</Text>
            </Pressable>
          </View>
        </>
      )}

      <View style={styles.metaBanner}>
        <View style={styles.metaLeft}>
          <Text style={styles.metaUploadDate}>
            {detail ? t('docDetail.uploadedOn', { date: formatUploadDate(detail.created_at) }) : ''}
          </Text>
          <Text style={styles.metaCounts}>
            {t('docDetail.fileTextCounts', { fileCount, textCount })}
          </Text>
        </View>
        <View style={[styles.learnedBadge, isLearned && styles.learnedBadgeActive]}>
          <Text style={[styles.learnedBadgeLabel, isLearned && styles.learnedBadgeLabelActive]}>
            {isLearned ? t('docDetail.learnedComplete') : t('docDetail.learnedPending')}
          </Text>
        </View>
      </View>
      <View style={styles.topDivider} />

      <KeyboardAvoidingView style={styles.chatKeyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={styles.chatContent}>
          {loading ? (
            <View style={styles.centerMessage}>
              <ActivityIndicator color={Brand.primary} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.centerMessage}>
              <Text style={styles.guideIcon}>📄</Text>
              <Text style={styles.guideText}>{t('docDetail.emptyGuide')}</Text>
            </View>
          ) : (
            messages.map((message, index) => {
              const showDateSep = index === 0 || dateKey(message.created_at) !== dateKey(messages[index - 1].created_at);
              const { icon, label } = bubbleLabel(message.type);
              const { title, description } = aiCardCopy(message.type);
              return (
                <View key={message.id} style={styles.row}>
                  {showDateSep && (
                    <View style={styles.dateSepRow}>
                      <View style={styles.dateSepLine} />
                      <Text style={styles.dateSepText}>{formatKoreanDate(message.created_at)}</Text>
                      <View style={styles.dateSepLine} />
                    </View>
                  )}

                  <View style={styles.userBubbleRow}>
                    <View style={styles.userBubble}>
                      <Text style={styles.userBubbleIcon}>{icon}</Text>
                      <Text style={styles.userBubbleLabel}>{label}</Text>
                    </View>
                  </View>

                  {message.status === 'processing' ? (
                    <View style={styles.aiBubble}>
                      <ActivityIndicator size="small" color={Brand.textDisabled} />
                    </View>
                  ) : message.status === 'failed' ? (
                    <View style={styles.aiBubble}>
                      <Text style={styles.aiFailedText}>{t('docDetail.analysisFailed')}</Text>
                    </View>
                  ) : (
                    <View style={styles.aiBubble}>
                      <View style={styles.aiTitleRow}>
                        <View style={styles.aiCheckIcon}>
                          <Text style={styles.aiCheckIconLabel}>✓</Text>
                        </View>
                        <Text style={styles.aiTitle}>{title}</Text>
                      </View>
                      <Text style={styles.aiDescription}>{description}</Text>
                      <Pressable style={styles.viewLearnedButton} onPress={() => setContextSheetVisible(true)}>
                        <Text style={styles.viewLearnedButtonSparkle}>✦</Text>
                        <Text style={styles.viewLearnedButtonLabel}>{t('docDetail.viewLearnedButton')}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={styles.inputBarWrap}>
          <View style={styles.inputPill}>
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder={t('docDetail.inputPlaceholder')}
              placeholderTextColor={Brand.textDisabled}
              style={styles.input}
              multiline
              // onContentSizeChange로 height를 JS state에 동기화하는 방식은 콜백이
              // 누락/지연되는 경우가 있어 박스가 전혀 안 커지거나 줄바꿈한 텍스트가
              // 잘려 보이지 않는 문제가 있었다. multiline TextInput은 minHeight/maxHeight만
              // 줘도 네이티브가 알아서 콘텐츠에 맞춰 자동으로 커지므로 그 방식으로 변경.
              textAlignVertical="top"
              editable={!sending}
            />
            <View style={styles.inputButtonRow}>
              <Pressable
                style={styles.attachButton}
                onPress={handlePressAttach}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('docDetail.attachAccessibilityLabel')}>
                <Text style={styles.attachButtonIcon}>+</Text>
              </Pressable>
              <Pressable
                style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
                onPress={handleSendText}
                disabled={!inputText.trim() || sending}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('docDetail.sendAccessibilityLabel')}>
                {sending ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text style={styles.sendButtonIcon}>↑</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <RenameProjectModal
        visible={renameVisible}
        currentName={detail?.title ?? ''}
        onClose={() => setRenameVisible(false)}
        onConfirm={handleRename}
        title={t('docDetail.renameModalTitle')}
        description={t('docDetail.renameModalDescription')}
      />

      <DeleteProjectModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
        onConfirm={handleDelete}
        title={t('docDetail.deleteModalTitle')}
        description={t('docDetail.deleteModalDescription')}
      />

      {document_id && (
        <DocumentContextSheet
          visible={contextSheetVisible}
          documentId={document_id}
          onClose={() => setContextSheetVisible(false)}
        />
      )}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: Brand.surfaceBackground,
    borderBottomWidth: 1,
    borderBottomColor: Brand.borderDisabled,
  },
  backIcon: {
    fontSize: 26,
    color: Brand.textPrimary,
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  moreIcon: {
    fontSize: 20,
    color: Brand.textPrimary,
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  menu: {
    position: 'absolute',
    top: 52,
    right: 16,
    zIndex: 11,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 140,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  menuItemLabel: {
    fontSize: 14,
    color: Brand.textPrimary,
  },
  menuItemDanger: {
    color: Brand.error,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
  },
  // Figma "meta-banner" — h52, bg white, 업로드일/개수 좌측 + 학습배지 우측.
  metaBanner: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: 'white',
  },
  metaLeft: {
    gap: 2,
  },
  metaUploadDate: {
    fontSize: 12,
    color: Brand.textDisabled,
  },
  metaCounts: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  learnedBadge: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.borderDisabled,
  },
  learnedBadgeActive: {
    backgroundColor: '#E8EBFF',
  },
  learnedBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Brand.textDisabled,
  },
  learnedBadgeLabelActive: {
    color: Brand.primary,
  },
  topDivider: {
    height: 1,
    backgroundColor: Brand.borderDisabled,
  },
  chatKeyboardAvoider: {
    flex: 1,
  },
  chatArea: {
    flex: 1,
    backgroundColor: Brand.surfaceBackground,
  },
  chatContent: {
    padding: 20,
    flexGrow: 1,
  },
  centerMessage: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  guideIcon: {
    fontSize: 32,
  },
  guideText: {
    fontSize: 14,
    color: Brand.textDisabled,
    textAlign: 'center',
    lineHeight: 20,
  },
  // 메시지 한 쌍(유저버블 + AI 응답카드) 사이 간격 — Figma chat-area gap:20.
  row: {
    marginBottom: 20,
    gap: 12,
  },
  dateSepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dateSepLine: {
    flex: 1,
    height: 1,
    backgroundColor: Brand.borderDisabled,
  },
  dateSepText: {
    fontSize: 12,
    color: Brand.textDisabled,
  },
  userBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  // Figma "user-bubble" — bg blue600, h36, rounded20, px14, gap8.
  userBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Brand.primary,
  },
  userBubbleIcon: {
    fontSize: 14,
  },
  userBubbleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'white',
  },
  // Figma "ai-bubble" — bg surface/background, border gray100, rounded16, padding14, gap10, w260.
  aiBubble: {
    width: 260,
    gap: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Brand.borderDisabled,
    backgroundColor: Brand.surfaceBackground,
  },
  aiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiCheckIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.primary,
  },
  aiCheckIconLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'white',
  },
  aiTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: Brand.primary,
  },
  aiDescription: {
    fontSize: 13,
    color: Brand.textSecondary,
    lineHeight: 18,
  },
  aiFailedText: {
    fontSize: 13,
    color: Brand.error,
  },
  // Figma "btn-view-context" — bg white, border blue600, rounded10, h36.
  viewLearnedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Brand.primary,
    backgroundColor: 'white',
  },
  viewLearnedButtonSparkle: {
    fontSize: 11,
    color: Brand.primary,
  },
  viewLearnedButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Brand.primary,
  },
  // 채팅바 전체 래퍼는 투명 — 흰색/그림자는 input-pill 영역에만 적용.
  inputBarWrap: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
  },
  // Figma "input-pill" — 내부는 흰색, 스트로크 주변에 Elevation/brand-md 그라데이션 글로우.
  inputPill: {
    borderWidth: 1,
    borderColor: Brand.border,
    borderRadius: 8,
    padding: 8,
    backgroundColor: 'white',
    gap: 4,
    shadowColor: '#1528A0',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 8,
  },
  input: {
    fontSize: 13,
    lineHeight: 18,
    color: Brand.textPrimary,
    paddingHorizontal: 2,
    paddingVertical: 0,
    minHeight: 23,
    maxHeight: 100,
    // 혹시라도 측정 도중 일시적으로 콘텐츠가 박스보다 커지더라도 아래 +/전송 버튼
    // 영역을 침범하지 않도록 clip — 정상 동작 시에는 박스 자체가 콘텐츠에 맞춰
    // minHeight~maxHeight 사이에서 커지므로 이 clip이 시각적으로 텍스트를 자르지 않는다.
    overflow: 'hidden',
  },
  inputButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attachButton: {
    width: 20,
    height: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#262626',
  },
  attachButtonIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
  sendButton: {
    width: 20,
    height: 20,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.primary,
  },
  sendButtonDisabled: {
    backgroundColor: Brand.borderDisabled,
  },
  sendButtonIcon: {
    fontSize: 12,
    fontWeight: '700',
    color: 'white',
  },
});
