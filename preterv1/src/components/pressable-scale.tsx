import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = PressableProps & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  hapticStyle?: Haptics.ImpactFeedbackStyle | null;
};

// 클로드 앱 버튼처럼 누르는 즉시 살짝 줄어들었다가 떼면 복원되는 공통 프레서블.
// 라이브 세션의 플레이/마이크 버튼처럼 "눌렀다"는 피드백이 중요한 곳에서 쓴다.
export function PressableScale({ style, scaleTo = 0.92, hapticStyle = Haptics.ImpactFeedbackStyle.Light, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      // Android 기본 ripple은 둥글게 잘려있지 않은(borderRadius 없는) 바깥 Pressable
      // 영역 전체에 그려져서, 안쪽의 둥근 버튼(Animated.View)보다 더 넓은 사각형
      // 모양의 회색 잔상이 누를 때마다 깜빡이며 보였다 — 이미 자체 스케일+햅틱
      // 피드백이 있으니 기본 ripple은 투명하게 꺼서 그 잔상을 없앤다.
      android_ripple={{ color: 'transparent' }}
      {...rest}
      onPressIn={(e) => {
        if (hapticStyle !== null) Haptics.impactAsync(hapticStyle);
        Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
        onPressOut?.(e);
      }}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{rest.children as React.ReactNode}</Animated.View>
    </Pressable>
  );
}
