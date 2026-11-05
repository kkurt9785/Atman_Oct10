// 공개 시연 계정(sales-demo-1/2/3@demo.atman.co.kr) — 영업 시연과 방문자가 같은 계정을 같이 쓴다.
// 한 사람이 '시연 초기화'를 누르면 다른 사람의 시연이 끊겨 서버·화면 모두 막는다(결정 4a). 시연 데이터는 매일 08:30 revive가 다시 만든다.
export const PUBLIC_DEMO_EMAIL_DOMAIN = '@demo.atman.co.kr';
export const PUBLIC_DEMO_RESET_BLOCKED = '공개 시연 계정에서는 초기화할 수 없어요. 시연 데이터는 매일 아침 자동으로 새로 만들어져요.';
export const PUBLIC_DEMO_DAILY_REFRESH = '시연 데이터는 매일 아침 자동으로 새로 만들어져요.';

export function isPublicDemoAccount(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(PUBLIC_DEMO_EMAIL_DOMAIN);
}
