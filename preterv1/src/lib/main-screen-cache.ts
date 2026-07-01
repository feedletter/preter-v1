import { Document } from '@/lib/documents';
import { Meeting, RecentMeeting } from '@/lib/meetings';
import { Project } from '@/lib/projects';
import { MyPlan, MyProfile } from '@/lib/users';

// 메인 화면은 expo-router의 화면 스택 특성상 router.replace('/main')으로 자주
// 재마운트된다(라이브 세션 종료/나가기 등). 매번 마운트될 때마다 스켈레톤을 다시
// 보여주며 4~5개 API를 재호출하면 불필요하게 느려 보인다 — 앱이 켜져 있는 동안은
// 한 번 불러온 데이터를 모듈 스코프에 들고 있다가 재마운트 시 즉시 보여주고,
// 새로고침은 pull-to-refresh 같은 명시적 액션에서만 다시 호출한다.
type MainScreenCache = {
  meetings: Meeting[];
  userName: string | null;
  profile: MyProfile | null;
  plan: MyPlan | null;
};

type SidePanelCache = {
  projects: Project[];
  meetings: RecentMeeting[];
  documents: Document[];
};

let mainCache: MainScreenCache | null = null;
let sidePanelCache: SidePanelCache | null = null;

export function getMainScreenCache(): MainScreenCache | null {
  return mainCache;
}

export function setMainScreenCache(value: MainScreenCache): void {
  mainCache = value;
}

export function getSidePanelCache(): SidePanelCache | null {
  return sidePanelCache;
}

export function setSidePanelCache(value: SidePanelCache): void {
  sidePanelCache = value;
}
