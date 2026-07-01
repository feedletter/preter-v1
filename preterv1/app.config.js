// app.json -> app.config.js 전환 (동적 설정).
// GoogleService-Info.plist / google-services.json은 Firebase 비밀 설정이라 git에는
// 올리지 않고 EAS file 환경변수(GOOGLE_SERVICE_INFO_PLIST / GOOGLE_SERVICES_JSON)로
// 업로드해뒀다 — EAS Build는 git에 트래킹된 파일만 업로드하므로, 로컬 개발 시엔 같은
// 이름의 로컬 파일을 그대로 쓰고 EAS 빌드 시엔 그 환경변수가 가리키는 경로를 쓴다.
module.exports = {
  expo: {
    name: 'preterv1',
    slug: 'preterv1',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'preterv1',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/images/icon.png',
      bundleIdentifier: 'com.preter.app',
      googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ['remote-notification'],
      },
      entitlements: {
        'aps-environment': 'production',
      },
    },
    android: {
      package: 'com.preter.app',
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          android: {
            image: './assets/images/splash-icon.png',
            imageWidth: 76,
          },
        },
      ],
      'expo-secure-store',
      [
        'expo-image-picker',
        {
          photosPermission: '프로필 사진을 선택하기 위해 사진 라이브러리 접근이 필요합니다',
          cameraPermission: '프로필 사진을 촬영하기 위해 카메라 접근이 필요합니다',
        },
      ],
      'expo-asset',
      '@react-native-community/datetimepicker',
      [
        'react-native-audio-api',
        {
          iosBackgroundMode: true,
          iosMicrophonePermission: '통역 세션에서 음성을 인식하기 위해 마이크 접근이 필요합니다',
          androidPermissions: [
            'android.permission.RECORD_AUDIO',
            'android.permission.MODIFY_AUDIO_SETTINGS',
            'android.permission.FOREGROUND_SERVICE',
            'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
          ],
          androidForegroundService: true,
          androidFSTypes: ['mediaPlayback'],
        },
      ],
      'expo-localization',
      '@react-native-firebase/app',
      '@react-native-firebase/messaging',
      '@react-native-firebase/crashlytics',
      '@react-native-firebase/analytics',
      [
        'expo-build-properties',
        {
          ios: {
            useFrameworks: 'static',
            forceStaticLinking: ['RNFBApp', 'RNFBAnalytics', 'RNFBCrashlytics', 'RNFBMessaging'],
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: '5448a968-4b23-45bc-a11e-a98ec6cabc49',
      },
    },
    owner: 'peterv1',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/5448a968-4b23-45bc-a11e-a98ec6cabc49',
    },
  },
};
