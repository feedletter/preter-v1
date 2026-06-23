// SNS 로그인 직후, 온보딩이 안 된 신규 유저를 위해 Card Intro → Form 화면 사이에서
// 이름/이메일을 들고 다니는 모듈 스코프 임시 저장소.

export type SnsDraft = {
  name: string;
  email: string;
  primaryLanguage: string;
};

let draft: SnsDraft = { name: '', email: '', primaryLanguage: 'ko' };

export function getSnsDraft(): SnsDraft {
  return draft;
}

export function setSnsDraft(partial: Partial<SnsDraft>): void {
  draft = { ...draft, ...partial };
}

export function resetSnsDraft(): void {
  draft = { name: '', email: '', primaryLanguage: 'ko' };
}
