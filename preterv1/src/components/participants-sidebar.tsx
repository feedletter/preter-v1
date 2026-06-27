import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Brand } from '@/constants/theme';
import { fetchRoomParticipants, kickParticipant, RoomParticipant } from '@/lib/rooms';
import { RoomUser } from '@/lib/live-session';

const PANEL_WIDTH = 300;

const LANGUAGE_FLAGS: Record<string, string> = {
  ko: '🇰🇷',
  en: '🇺🇸',
  ja: '🇯🇵',
  zh: '🇨🇳',
};

const LANGUAGE_LABELS: Record<string, string> = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
  zh: '중국어',
};

type ParticipantsSidebarProps = {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  roomCode: string;
  password: string | null;
  meetingTitle: string;
  hostName: string;
  isHost: boolean;
  myUserId: string;
  users: RoomUser[];
};

function formatRoomCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// Host Live Session PRD 9장 (SCR-HL-08/09) — 참가자 사이드바.
export function ParticipantsSidebar({
  visible,
  onClose,
  roomId,
  roomCode,
  password,
  meetingTitle,
  hostName,
  isHost,
  myUserId,
  users,
}: ParticipantsSidebarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [participantRows, setParticipantRows] = useState<RoomParticipant[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const dimOpacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(PANEL_WIDTH)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (isHost) {
        fetchRoomParticipants(roomId)
          .then(setParticipantRows)
          .catch(() => setParticipantRows([]));
      }
      Animated.parallel([
        Animated.timing(dimOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateX, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(dimOpacity, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateX, { toValue: PANEL_WIDTH, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, isHost, roomId, dimOpacity, translateX]);

  if (!mounted) return null;

  // 참가자 입장/퇴장이 ROOM_STATE_UPDATE로 실시간 반영되어야 정상이지만, 네트워크
  // 끊김 등으로 한 번 누락되면 사이드바가 영구히 옛 명단을 보여줄 수 있다 — 풀투
  // 리프레시로 호스트는 참가자 행(participantRows)을 다시 조회할 수 있는 안전망을 둔다.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      if (isHost) {
        const rows = await fetchRoomParticipants(roomId);
        setParticipantRows(rows);
      }
    } catch {
      // 새로고침 실패는 조용히 무시 — 기존 명단을 그대로 유지.
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCopyCode() {
    await Clipboard.setStringAsync(formatRoomCode(roomCode));
    Alert.alert(t('participantsSidebar.copied'));
  }

  async function handleCopyPassword() {
    if (!password) return;
    await Clipboard.setStringAsync(password);
    Alert.alert(t('participantsSidebar.copied'));
  }

  async function handleShare() {
    const message = [
      "You're invited to join a Preter interpretation session!",
      `Host: ${hostName}`,
      `Meeting: ${meetingTitle}`,
      `Room Code: ${roomCode}`,
      `Password: ${password ?? 'Not set'}`,
      `Join now: preter.me/join?code=${roomCode}`,
    ].join('\n');
    try {
      await Share.share({ message });
    } catch {
      // 공유 취소는 무시.
    }
  }

  // 호스트가 항상 맨 위에 보이도록 정렬한다 — 서버가 보내는 순서(연결 순서)에 의존하지 않는다.
  const sortedUsers = [...users].sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : 0));

  function findParticipantRow(userId: string): RoomParticipant | undefined {
    return participantRows.find((row) => row.user_id === userId || row.guest_session_id === userId);
  }

  function handleKick(user: RoomUser) {
    const row = findParticipantRow(user.userId);
    if (!row) return;
    Alert.alert(t('participantsSidebar.kickConfirmTitle', { name: user.displayName }), undefined, [
      { text: t('participantsSidebar.cancel'), style: 'cancel' },
      {
        text: t('participantsSidebar.kick'),
        style: 'destructive',
        onPress: async () => {
          try {
            await kickParticipant(roomId, row.id);
            setParticipantRows((prev) => prev.filter((r) => r.id !== row.id));
          } catch {
            Alert.alert(t('participantsSidebar.kickFailed'));
          }
        },
      },
    ]);
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.dim, { opacity: dimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, transform: [{ translateX }] },
        ]}>
        <Text style={styles.title}>{t('participantsSidebar.title', { count: users.length })}</Text>
        <ScrollView
          style={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Brand.primary} />}>
          {sortedUsers.map((user) => {
            const isMe = user.userId === myUserId;
            return (
              <View key={user.userId} style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialOf(user.displayName)}</Text>
                </View>
                <View style={styles.rowTextCol}>
                  <View style={styles.nameLine}>
                    <Text style={styles.name} numberOfLines={1}>
                      {user.displayName}
                      {isMe ? ` ${t('participantsSidebar.meIndicator')}` : ''}
                    </Text>
                    {user.role === 'host' && (
                      <View style={styles.hostBadge}>
                        <Text style={styles.hostBadgeLabel}>HOST</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.languageLine}>
                    {LANGUAGE_FLAGS[user.language] ?? '🌐'} {LANGUAGE_LABELS[user.language] ?? user.language}
                  </Text>
                </View>
                {isHost && !isMe && (
                  <Pressable onPress={() => handleKick(user)} hitSlop={8} accessibilityLabel={t('participantsSidebar.kick')}>
                    <Text style={styles.kickIcon}>✕</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.footerRow} onPress={handleCopyCode}>
            <Text style={styles.footerLabel}>{t('participantsSidebar.meetingCode')}</Text>
            <Text style={styles.footerValue}>{formatRoomCode(roomCode)}</Text>
          </Pressable>
          <Pressable style={styles.footerRow} onPress={handleCopyPassword} disabled={!password}>
            <Text style={styles.footerLabel}>{t('participantsSidebar.meetingPassword')}</Text>
            <Text style={styles.footerValue}>{password ?? t('participantsSidebar.passwordNotSet')}</Text>
          </Pressable>
          <Pressable style={styles.shareButton} onPress={handleShare} accessibilityRole="button">
            <Text style={styles.shareButtonLabel}>{t('participantsSidebar.shareButton')}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  panel: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: 'white',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Brand.textPrimary,
  },
  list: {
    flex: 1,
    marginTop: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E8EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.primary,
  },
  rowTextCol: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 14,
    color: Brand.textPrimary,
    flexShrink: 1,
  },
  hostBadge: {
    backgroundColor: Brand.primary,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  hostBadgeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'white',
  },
  languageLine: {
    fontSize: 12,
    color: Brand.textSecondary,
  },
  kickIcon: {
    fontSize: 14,
    color: Brand.textDisabled,
    padding: 4,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Brand.borderDisabled,
    paddingTop: 16,
    gap: 12,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLabel: {
    fontSize: 13,
    color: Brand.textSecondary,
  },
  footerValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Brand.textPrimary,
  },
  shareButton: {
    backgroundColor: Brand.primary,
    borderRadius: 8,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  shareButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
});
