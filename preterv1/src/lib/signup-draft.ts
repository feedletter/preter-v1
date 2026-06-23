// 회원가입 3단계(Card Intro → Form → Profile) 사이에서 입력값을 들고 다니는
// 모듈 스코프 임시 저장소. 가입 완료/이탈 시 resetSignupDraft()로 비운다.

export type SignupDraft = {
  primaryLanguage: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  countryCode: string;
  companyEmail: string;
  position: string;
  companyName: string;
};

const initialDraft: SignupDraft = {
  primaryLanguage: 'ko',
  name: '',
  email: '',
  password: '',
  phone: '',
  countryCode: '+82',
  companyEmail: '',
  position: '',
  companyName: '',
};

let draft: SignupDraft = { ...initialDraft };

export function getSignupDraft(): SignupDraft {
  return draft;
}

export function updateSignupDraft(partial: Partial<SignupDraft>): void {
  draft = { ...draft, ...partial };
}

export function resetSignupDraft(): void {
  draft = { ...initialDraft };
}
