import * as Updates from 'expo-updates';

// 콜드 스타트 시 1회만 OTA를 확인·즉시 적용한다.
//
// expo-updates 기본 동작은 새 번들을 백그라운드로 받아 '다음 실행'에 적용해서, 발행 후
// 앱을 두 번 껐다 켜야 반영됐다. 여기서 시작 시점에 즉시 fetch + reload하면 한 번의 실행으로
// 최신 코드가 적용된다.
//
// 주의: reloadAsync는 앱을 재시작하므로, 라이브 세션처럼 진행 중인 화면을 끊으면 안 된다.
// 그래서 반드시 앱 최초 마운트(콜드 스타트) 시점에만 1회 호출한다 — 실사용자는 이 시점엔
// 아직 미팅에 들어가기 전이라 재시작이 안전하다. dev 클라이언트/Expo Go에서는 OTA가 없으므로
// (Updates.isEnabled=false) 조용히 건너뛴다.
let started = false;

export async function applyPendingUpdateOnStartup(): Promise<void> {
  if (started) return;
  started = true;
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // 네트워크 실패/체크 실패 등 — 캐시된 번들로 그대로 진행하고 업데이트는 다음 기회에.
    // 시작을 절대 블록하지 않는다(실패해도 앱은 정상 구동돼야 함).
  }
}
