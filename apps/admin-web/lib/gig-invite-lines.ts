// 근무 건 '새 사람 초대'를 여러 명 한 번에 할 때 화면과 서버가 같이 쓰는 값.
// ('use server' 파일은 상수를 내보낼 수 없어서 따로 둔다)
export const GIG_INVITE_BATCH_MAX = 20;

export type GigInvitePerson = { name: string; phone: string };

const PHONE = /010[-.\s]?\d{4}[-.\s]?\d{4}/;

// 카톡·엑셀에서 복사한 명단 한 줄 → 이름 + (있으면) 전화번호.
// "1. 김하늘 010-1234-5678", "김하늘\t01012345678", "김하늘" 모두 읽는다.
export function parseInviteLine(line: string): GigInvitePerson {
  const phone = line.match(PHONE)?.[0] ?? '';
  const name = (phone ? line.replace(phone, ' ') : line)
    .replace(/^\s*\d{1,3}\s*[.)]\s+/, '')
    .replace(/[\t,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, phone: phone.trim() };
}

export function parseInviteLines(text: string): GigInvitePerson[] {
  return text.split(/\r?\n/).map(parseInviteLine).filter((person) => person.name || person.phone);
}
