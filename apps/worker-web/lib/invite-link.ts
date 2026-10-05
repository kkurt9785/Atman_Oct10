// 초대 링크(또는 토큰만) → 토큰. 사장님이 보낸 카톡 문자 전체를 복사해 와도 그 안의 링크를 찾아낸다.
export function parseInviteToken(value: string): string | null {
  const text = value.trim();
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text)) return text;
  const candidate = text.match(/https?:\/\/\S+/)?.[0] ?? text;
  try { return new URL(candidate).searchParams.get('token'); } catch { return null; }
}
