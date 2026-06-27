import { StyleSheet, Text, View } from 'react-native';

import { Brand } from '@/constants/theme';
import type { RoomUser } from '@/lib/live-session';

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// Figma 297:21549 (TopBar) — 참가자 아바타 스택. 1명이면 원형 아바타 1개, 2~3명이면
// 32px 원을 반으로 잘라 왼쪽엔 첫 참가자, 오른쪽은 위/아래로 나머지 1~2명을 쌓아 겹쳐 보인다.
// 4명 초과(MVP 룸 인원 상한이 4명이라 실제로는 안 나오지만 방어적으로)는 왼쪽 1명 +
// 오른쪽에 마지막 2명만 보여주고 나머지는 숫자로 잘린다.
export function AvatarStack({ users }: { users: RoomUser[] }) {
  if (users.length <= 1) {
    const label = users[0] ? initialOf(users[0].displayName) : '1';
    return (
      <View style={styles.single}>
        <Text style={styles.label}>{label}</Text>
      </View>
    );
  }

  const [first, ...rest] = users;
  const rightUsers = rest.slice(0, 2);

  return (
    <View style={styles.stack}>
      <View style={styles.half}>
        <Text style={styles.labelSmall}>{initialOf(first.displayName)}</Text>
      </View>
      <View style={styles.rightCol}>
        {rightUsers.map((user, i) => (
          <View key={user.userId} style={[styles.quarter, i === 0 && rightUsers.length > 1 && styles.quarterDivider]}>
            <Text style={styles.labelTiny}>{initialOf(user.displayName)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  single: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'white',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  half: {
    flex: 1,
    backgroundColor: '#E8EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightCol: {
    flex: 1,
    flexDirection: 'column',
  },
  quarter: {
    flex: 1,
    backgroundColor: '#DCE2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quarterDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'white',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: Brand.primary,
  },
  labelSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: Brand.primary,
  },
  labelTiny: {
    fontSize: 8,
    fontWeight: '700',
    color: Brand.primary,
  },
});
