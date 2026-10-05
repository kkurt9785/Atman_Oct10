// 바로 앞에 본 앱 안 화면 — 뒤로가기 버튼이 history.back 을 써도 되는지(앞 화면이 상위 화면인지) 판단한다.
// 새로고침·알림·링크로 바로 열리면 비어 있다.
let previous: string | null = null;
let current: string | null = null;

export function trackPath(path: string) {
  if (path === current) return;
  previous = current;
  current = path;
}

export function previousPath() {
  return previous;
}
