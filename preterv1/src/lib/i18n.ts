import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import ja from '@/locales/ja.json';
import ko from '@/locales/ko.json';

// 앱 UI 표시 언어. 통역 언어(primary_language)와는 완전히 별개 개념 —
// 절대 같은 변수/컬럼으로 묶지 말 것.
export type AppLanguage = 'ko' | 'ja' | 'en';
export const SUPPORTED_APP_LANGUAGES: AppLanguage[] = ['ko', 'ja', 'en'];
const FALLBACK_LANGUAGE: AppLanguage = 'en';

// 정책: ko/ja는 그대로, 그 외 모든 디바이스 언어(중국어, 베트남어 등)는 영어로 처리.
export function resolveDeviceLanguage(): AppLanguage {
  const deviceCode = Localization.getLocales()[0]?.languageCode;
  if (deviceCode === 'ko' || deviceCode === 'ja') return deviceCode;
  return FALLBACK_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: resolveDeviceLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: { escapeValue: false },
});

// 로그인 사용자의 users.app_language(명시적으로 고른 값)가 있으면 디바이스 로캘보다
// 우선한다 — 프로필 설정 화면에서 변경 시에도 이 함수로 호출해 즉시 전환한다.
export function setAppLanguage(language: string | null | undefined) {
  if (language && SUPPORTED_APP_LANGUAGES.includes(language as AppLanguage)) {
    i18n.changeLanguage(language);
  } else {
    i18n.changeLanguage(resolveDeviceLanguage());
  }
}

export default i18n;
