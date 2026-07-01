import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

export type SpeakListenState = 'speaking' | 'listening' | 'idle';

export const BAR_WRAP_HEIGHT = 2;
export const ORB_RADIUS = 0;

const SPEAK_COLOR = '#4F8DFF';
const LISTEN_COLOR = '#FF5A52';

export function SpeakListenOrb({ state }: { state: SpeakListenState }) {
  const blink = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state === 'idle') {
      blink.stopAnimation();
      blink.setValue(0);
      return;
    }
    blink.setValue(0);
    const duration = state === 'speaking' ? 425 : 750;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(blink, { toValue: 0, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, blink]);

  if (state === 'idle') return <View style={styles.wrap} />;

  const isSpeaking = state === 'speaking';
  const color = isSpeaking ? SPEAK_COLOR : LISTEN_COLOR;
  const barWidth = isSpeaking ? 110 : 200;
  const minOpacity = isSpeaking ? 0.65 : 0.45;
  const opacity = blink.interpolate({ inputRange: [0, 1], outputRange: [minOpacity, 1] });

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          styles.bar,
          {
            width: barWidth,
            backgroundColor: color,
            shadowColor: color,
            opacity,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: BAR_WRAP_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    height: 2,
    borderRadius: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 4,
  },
});
