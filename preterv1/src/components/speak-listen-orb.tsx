import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Brand } from '@/constants/theme';

export type SpeakListenState = 'speaking' | 'listening' | 'idle';

// 발화/청취 상태를 보여주는 글로우 오브. 막대 형태였던 이전 버전 대신, bottom bar
// 경계선에 원의 가로 중심을 맞춰서 위쪽 절반만 화면에 보이고 아래쪽 절반은 bottom bar
// 불투명 배경에 자연스럽게 가려지게 만든다 — 그래서 이 컴포넌트는 항상 부모가
// `bottom: BOTTOM_BAR_HEIGHT - ORB_RADIUS`로 배치하고, JSX 순서상 bottom bar보다
// 먼저 렌더링되어야 한다(같은 부모의 형제 노드는 나중에 그려진 게 위에 덮인다).
export const ORB_DIAMETER = 64;
export const ORB_RADIUS = ORB_DIAMETER / 2;

const SPEAK_COLOR = Brand.primary;
const LISTEN_COLOR = Brand.error;

export function SpeakListenOrb({ state }: { state: SpeakListenState }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const morph = useRef(new Animated.Value(state === 'listening' ? 1 : 0)).current;

  useEffect(() => {
    if (state === 'idle') {
      breathe.stopAnimation();
      breathe.setValue(0);
      return;
    }
    breathe.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    // speaking ↔ listening 전환 시 색/크기가 탄력있게 바뀌도록 — opacity/scale만 보간하므로
    // 네이티브 드라이버로 돌려도 안전하다.
    Animated.spring(morph, {
      toValue: state === 'listening' ? 1 : 0,
      useNativeDriver: true,
      bounciness: 10,
      speed: 10,
    }).start();
    return () => loop.stop();
  }, [state, breathe, morph]);

  if (state === 'idle') {
    return <View style={styles.wrap} />;
  }

  const color = state === 'speaking' ? SPEAK_COLOR : LISTEN_COLOR;
  const haloOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.38] });
  const haloScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const coreScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] });
  const ringScale = morph.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[styles.halo, { backgroundColor: color, opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
      />
      <Animated.View style={[styles.ring, { borderColor: color, transform: [{ scale: ringScale }] }]} />
      <Animated.View style={[styles.core, { backgroundColor: color, transform: [{ scale: coreScale }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: ORB_DIAMETER,
    height: ORB_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: ORB_DIAMETER,
    height: ORB_DIAMETER,
    borderRadius: ORB_RADIUS,
  },
  ring: {
    position: 'absolute',
    width: ORB_DIAMETER * 0.62,
    height: ORB_DIAMETER * 0.62,
    borderRadius: (ORB_DIAMETER * 0.62) / 2,
    borderWidth: 1.5,
    opacity: 0.55,
  },
  core: {
    width: ORB_DIAMETER * 0.34,
    height: ORB_DIAMETER * 0.34,
    borderRadius: (ORB_DIAMETER * 0.34) / 2,
  },
});
