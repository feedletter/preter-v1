import { getApp } from '@react-native-firebase/app';
import {
  getAnalytics,
  logEvent as logAnalyticsEvent,
  setUserId as setAnalyticsUserId,
} from '@react-native-firebase/analytics';
import { getCrashlytics, log as crashlyticsLog, recordError, setUserId as setCrashlyticsUserId } from '@react-native-firebase/crashlytics';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';

const app = getApp();
const analytics = getAnalytics(app);
const crashlytics = getCrashlytics();
const messaging = getMessaging(app);

// 알림 권한 요청 + FCM 토큰 발급. iOS는 권한 거부 시 토큰을 받을 수 없음.
export async function requestFcmToken(): Promise<string | null> {
  const authStatus = await requestPermission(messaging);
  const enabled =
    authStatus === AuthorizationStatus.AUTHORIZED || authStatus === AuthorizationStatus.PROVISIONAL;
  if (!enabled) return null;
  return getToken(messaging);
}

export function watchFcmTokenRefresh(onRefresh: (token: string) => void): () => void {
  return onTokenRefresh(messaging, onRefresh);
}

export function logEvent(name: string, params?: Record<string, unknown>): void {
  void logAnalyticsEvent(analytics, name, params);
}

// expo-router는 React Navigation 자동 screen_view 연동이 없어, pathname 변화를 직접 잡아서 보낸다.
export function logScreenView(screenName: string): void {
  void logAnalyticsEvent(analytics, 'screen_view', {
    screen_name: screenName,
    screen_class: screenName,
  });
}

export function setAnalyticsUser(userId: string | null): void {
  void setAnalyticsUserId(analytics, userId);
}

export function setCrashUser(userId: string | null): void {
  void setCrashlyticsUserId(crashlytics, userId ?? '');
}

export function logCrashBreadcrumb(message: string): void {
  void crashlyticsLog(crashlytics, message);
}

export function reportError(error: Error): void {
  void recordError(crashlytics, error);
}

// 네이티브 크래시는 Crashlytics가 자동 수집하지만, JS 단 예외/unhandled rejection은
// 잡아서 직접 보내야 한다 — 안 하면 "JS 에러로 인한 크래시"가 콘솔에 전혀 안 보임.
type JsErrorHandler = (error: Error, isFatal?: boolean) => void;

export function installGlobalErrorHandlers(): void {
  const errorUtils = (global as { ErrorUtils?: { setGlobalHandler: (fn: JsErrorHandler) => void; getGlobalHandler: () => JsErrorHandler } }).ErrorUtils;
  if (errorUtils) {
    const defaultHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      recordError(crashlytics, error, isFatal ? 'FatalJSError' : 'JSError');
      defaultHandler?.(error, isFatal);
    });
  }

  require('promise/setimmediate/rejection-tracking').enable({
    allRejections: true,
    onUnhandled: (_id: number, error: Error) => {
      recordError(crashlytics, error, 'UnhandledPromiseRejection');
    },
  });
}
