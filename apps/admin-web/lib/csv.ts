// CSV 한 칸. 엑셀·구글 시트는 = + - @ (또는 탭·CR)로 시작하는 칸을 수식으로 실행한다(CSV 수식 주입).
// 이름·수정 사유처럼 사람이 입력한 글은 앞에 ' 를 붙여 글자로 열리게 한다. 숫자 값(금액·분)은 수식이 될 수 없어 그대로 둔다.
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = typeof value !== 'number' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

// 내려받는 파일 이름을 한글로. 한글을 못 읽는 브라우저는 앞의 영문 이름을 쓴다(RFC 5987).
export function csvAttachment(asciiName: string, koreanName: string): string {
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(koreanName)}`;
}
