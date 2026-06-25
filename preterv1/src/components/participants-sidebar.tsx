import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [participantRows, setParticipantRows] = useState<RoomParticipant[]>([]);
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

  async function handleCopyCode() {
    await Clipboard.setStringAsync(formatRoomCode(roomCode));
    Alert.alert('복사됐어요');
  }

  async function handleCopyPassword() {
    if (!password) return;
    await Clipboard.setStringAsync(password);
    Alert.alert('복사됐어요');
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
    Alert.alert(`${user.displayName}님을 내보낼까요?`, undefined, [
      { text: '취소', style: 'cancel' },
      {
        text: '내보내기',
        style: 'destructive',
        onPress: async () => {
          try {
            await kickParticipant(roomId, row.id);
            setParticipantRows((prev) => prev.filter((r) => r.id !== row.id));
          } catch {
            Alert.alert('강퇴에 실패했어요');
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
        <Text style={styles.title}>참가자 ({users.length})</Text>
        <View style={styles.list}>
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
                      {isMe ? ' (나)' : ''}
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
                  <Pressable onPress={() => handleKick(user)} hitSlop={8} accessibilityLabel="강퇴">
                    <Text style={styles.kickIcon}>✕</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Pressable style={styles.footerRow} onPress={handleCopyCode}>
            <Text style={styles.footerLabel}>미팅 코드</Text>
            <Text style={styles.footerValue}>{formatRoomCode(roomCode)}</Text>
          </Pressable>
          <Pressable style={styles.footerRow} onPress={handleCopyPassword} disabled={!password}>
            <Text style={styles.footerLabel}>미팅 비밀번호</Text>
            <Text style={styles.footerValue}>{password ?? '설정 안함'}</Text>
          </Pressable>
          <Pressable style={styles.shareButton} onPress={handleShare} accessibilityRole="button">
            <Text style={styles.shareButtonLabel}>참가 정보 공유하기</Text>
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
