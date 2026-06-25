import { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';

import type { LiveSessionEvent } from '@/lib/live-session';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const WS_URL = API_URL.replace(/^http/, 'ws');

// live-engine.html 이 RN으로 올려보내는 엔진 상태(오디오/소켓 생명주기 신호).
export type EngineStatus =
  | 'ready'
  | 'ws-open'
  | 'ws-close'
  | 'mic-started'
  | 'mic-stopped'
  | 'error';

export type LiveAudioBridgeHandle = {
  startMic: () => void;
  stopMic: () => void;
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
};

type Props = {
  roomId: string;
  onEvent: (event: LiveSessionEvent) => void;
  onStatus?: (status: EngineStatus, detail?: string | null) => void;
};

/**
 * 라이브 세션 헤드리스 오디오 엔진(WebView) 래퍼.
 *
 * 화면 UI는 네이티브(host-live-session 등)가 그리고, 이 컴포넌트는 보이지 않는
 * WebView 안에서 마이크 캡처/통역 오디오 재생 + 단일 WebSocket을 돌린다.
 * 서버가 user_id로 참가자를 식별·덮어쓰므로 라이브 세션 소켓은 이 엔진만 소유한다.
 */
export const LiveAudioBridge = forwardRef<LiveAudioBridgeHandle, Props>(
  ({ roomId, onEvent, onStatus }, ref) => {
    const webviewRef = useRef<WebView>(null);

    const post = (cmd: Record<string, unknown>) => {
      const json = JSON.stringify(cmd);
      webviewRef.current?.injectJavaScript(`window.__pcmd(${JSON.stringify(json)}); true;`);
    };

    useImperativeHandle(ref, () => ({
      startMic: () => post({ type: 'startMic' }),
      stopMic: () => post({ type: 'stopMic' }),
      send: (payload) => post({ type: 'send', payload }),
      close: () => post({ type: 'close' }),
    }));

    const handleMessage = async (e: WebViewMessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }

      if (msg.__event) {
        onEvent(msg.payload as LiveSessionEvent);
        return;
      }

      if (msg.__engine) {
        const status = msg.status as EngineStatus;
        onStatus?.(status, (msg.detail as string | null) ?? null);
        // 엔진이 준비되면 토큰을 붙여 소켓 연결을 지시한다.
        if (status === 'ready') {
          const token = await SecureStore.getItemAsync('access_token');
          const url = `${WS_URL}/ws/room/${roomId}?token=${encodeURIComponent(token ?? '')}`;
          post({ type: 'connect', url });
        }
      }
    };

    return (
      <View style={{ width: 0, height: 0, opacity: 0 }} pointerEvents="none">
        <WebView
          ref={webviewRef}
          // getUserMedia는 보안 컨텍스트(https)에서만 동작한다 — require()로 번들된
          // file:// 로컬 에셋을 로드하면 navigator.mediaDevices가 undefined가 되어
          // 마이크 캡처가 항상 조용히 실패하므로, 백엔드가 HTTPS로 서빙하는 페이지를 로드한다.
          source={{ uri: `${API_URL}/static/live-engine.html` }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          // 마이크 캡처 + 자동 재생 허용 (사용자 제스처 없이 통역 오디오 재생).
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          // iOS 15+ 에서 WKWebView의 getUserMedia 권한 프롬프트를 자동 승인한다.
          // (iOS 14.x는 WKUIDelegate의 media capture 권한 API 자체가 없어 이 옵션이 적용되지
          // 않고, getUserMedia가 항상 거부된다 — 마이크가 안 잡히면 가장 먼저 의심할 지점.)
          // Android는 react-native-webview 네이티브 코드가 RESOURCE_AUDIO_CAPTURE를
          // 자동으로 요청/승인하므로 별도 처리가 필요 없다.
          mediaCapturePermissionGrantType="grant"
          onMessage={handleMessage}
        />
      </View>
    );
  },
);

LiveAudioBridge.displayName = 'LiveAudioBridge';
