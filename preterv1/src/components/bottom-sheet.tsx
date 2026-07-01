import * as Haptics from 'expo-haptics';
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/constants/theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;
// 이 거리(픽셀) 이상 아래로 끌거나, 그보다 적게 끌어도 빠르게 튕기듣 손을 떼면(velocity)
// 닫힘으로 완료시킨다. 그 이하면 원래 위치로 스냅백.
const CLOSE_DRAG_THRESHOLD = 120;

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  sheetStyle?: StyleProp<ViewStyle>;
};

// 딤 배경은 fade, 시트는 slide-up으로 서로 다른 애니메이션을 동시에 돌려야
// "마스킹이 시트와 같이 밀려 올라오는" 부자연스러운 느낌이 없어진다.
// RN Modal의 animationType은 모달 전체(딤 포함)에 단일 효과만 적용되기 때문에
// animationType="none"으로 끄고 두 레이어를 직접 Animated로 따로 제어한다.
export function BottomSheet({ visible, onClose, children, sheetStyle }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const dimOpacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Animated.parallel([
        Animated.timing(dimOpacity, {
          toValue: 1,
          duration: 250,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        // overshoot 없는 timing으로 — spring은 도착점을 지나쳤다가 되돌아오는
        // 통통 튀는 느낌(bounce)을 만들어서 바닥에서 시트가 잠깐 떨어져 보였다.
        Animated.timing(translateY, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(dimOpacity, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 핸들(상단 손잡이 바) 영역에서만 드래그를 가로챈다 — 시트 본문에 ScrollView가
  // 들어있는 경우가 많아서, 본문 전체에 붙이면 스크롤 제스처와 충돌한다.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_, gesture) => {
        const shouldClose = gesture.dy > CLOSE_DRAG_THRESHOLD || gesture.vy > 0.8;
        if (shouldClose) {
          onClose();
          return;
        }
        Animated.timing(translateY, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.dim, { opacity: dimOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[styles.sheetWrap, { transform: [{ translateY }] }]}
          pointerEvents="box-none">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoider}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }, sheetStyle]}>
              <View style={styles.handleRow} {...panResponder.panHandlers}>
                <View style={styles.handle} />
              </View>
              {children}
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  // KeyboardAvoidingView가 padding을 붙일 대상 — 키보드가 올라오면 이 만큼
  // 아래쪽 여백이 생겨서 sheetWrap의 justifyContent:'flex-end'가 시트 전체를
  // 키보드 위로 밀어 올린다.
  keyboardAvoider: {
    width: '100%',
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  // 실제로 보이는 손잡이 바(handle)는 작지만, 드래그를 받는 영역(handleRow)은
  // 그보다 넉넉하게 키워서 손잡이 주변을 눌러도 스와이프 닫기가 시작되게 한다.
  handleRow: {
    height: 32,
    marginTop: -8,
    marginBottom: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Brand.border,
  },
});
