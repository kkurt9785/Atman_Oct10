import type { BrowserInfo } from './in-app-browser';

// 홈 화면에 추가하는 단계 — 그 브라우저에서 실제로 눌러야 하는 버튼만 순서대로(그림은 components/install/InstallSteps).
// 아이폰은 웹에서 설치 창을 띄울 수 없어(애플 정책) 사용자가 사파리 버튼을 직접 눌러야 한다.
// iOS 26부터 사파리 기본 배치는 주소창 오른쪽 ⋯ 안에 공유가 있다(그 전에는 아래 가운데 공유 버튼).

export type InstallStepIcon = 'more' | 'share' | 'add' | 'done' | 'kebab' | 'menu' | 'install';
export type InstallStep = { icon: InstallStepIcon; title: string; hint?: string };

/** 이 브라우저에서 홈 화면에 추가하는 단계. 안내할 수 없는 브라우저(앱 안 브라우저·PC 등)는 null */
export function installStepsFor(info: BrowserInfo): InstallStep[] | null {
  if (info.inApp) return null;
  // 버전을 모르는 사파리(앱 안 브라우저에서 넘어갈 곳 안내 등) — 두 배치 모두 통하게
  if (info.safari && info.safariMajor === null) return [
    { icon: 'share', title: '공유 누르기', hint: '안 보이면 주소창 오른쪽 ⋯ 를 먼저 눌러요' },
    { icon: 'add', title: '홈 화면에 추가', hint: '안 보이면 목록을 위로 올려 주세요' },
    { icon: 'done', title: '추가 누르기' },
  ];
  if (info.safari && (info.safariMajor ?? 0) >= 26) return [
    { icon: 'more', title: '주소창 오른쪽 ⋯ 누르기' },
    { icon: 'share', title: '공유 누르기' },
    { icon: 'add', title: '홈 화면에 추가', hint: '안 보이면 목록을 위로 올려 주세요' },
    { icon: 'done', title: '추가 누르기', hint: '웹 앱으로 열기는 켜 둔 채로' },
  ];
  if (info.safari) return [
    { icon: 'share', title: '아래 가운데 공유 누르기' },
    { icon: 'add', title: '홈 화면에 추가', hint: '안 보이면 목록을 위로 올려 주세요' },
    { icon: 'done', title: '오른쪽 위 추가 누르기' },
  ];
  if (info.chromeIos) return [
    { icon: 'share', title: '주소창 오른쪽 공유 누르기' },
    { icon: 'add', title: '홈 화면에 추가' },
    { icon: 'done', title: '추가 누르기' },
  ];
  if (info.android && info.samsung) return [
    { icon: 'menu', title: '아래 오른쪽 ≡ 메뉴 누르기', hint: '주소창에 설치 아이콘이 보이면 그걸 눌러도 돼요' },
    { icon: 'add', title: '현재 페이지 추가 → 홈 화면' },
    { icon: 'done', title: '추가 누르기' },
  ];
  if (info.android) return [
    { icon: 'kebab', title: '오른쪽 위 ⋮ 누르기' },
    { icon: 'install', title: '앱 설치 누르기', hint: '없으면 홈 화면에 추가' },
    { icon: 'done', title: '설치 누르기' },
  ];
  return null;
}
