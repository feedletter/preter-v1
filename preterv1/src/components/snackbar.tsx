import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/constants/theme';

type SnackbarProps = {
  visible: boolean;
  message: string;
  onHide: () => void;
};

// Create Meeting PRD 3.2.2 (Node: 365:3130) — 상단 고정 Snackbar, 3초 후 자동 사라짐.
export function Snackbar({ visible, message, onHide }: SnackbarProps) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHide();
      });
    }, 3000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, message]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 9, opacity }]}
      pointerEvents="box-none">
      <Pressable style={styles.bar} onPress={onHide} accessibilityLiveRegion="assertive">
        <Text style={styles.checkIcon}>✓</Text>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        <Text style={styles.closeIcon} onPress={onHide}>
          ×
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  checkIcon: {
    fontSize: 16,
    color: '#06C755',
    width: 24,
    textAlign: 'center',
  },
  message: {
    flex: 1,
    fontSize: 14,
    color: Brand.textPrimary,
  },
  closeIcon: {
    fontSize: 18,
    color: Brand.textDisabled,
    width: 20,
    textAlign: 'center',
  },
});
