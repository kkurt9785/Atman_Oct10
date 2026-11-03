import 'server-only';

// 국세청 사업자등록 상태조회 (공공데이터포털 '국세청_사업자등록정보 진위확인 및 상태조회 서비스').
// 키(NTS_BUSINESS_API_KEY)가 없으면 null 을 돌려 주고 호출한 쪽은 '미조회'로 둔다 — 운영자 확인은 그대로 남는다.
export type BusinessStatus = 'active' | 'suspended' | 'closed' | 'unknown';
export type BusinessStatusResult = { status: BusinessStatus; detail: string; checkedAt: string };

const CODE: Record<string, BusinessStatus> = { '01': 'active', '02': 'suspended', '03': 'closed' };
export const BUSINESS_STATUS_LABEL: Record<string, string> = { active: '계속사업자', suspended: '휴업', closed: '폐업', unknown: '미등록·조회 불가' };

// 공공데이터포털은 같은 키를 Encoding(%2F·%2B·%3D 가 보이는 형태)·Decoding 두 가지로 보여 준다. 어느 쪽을 넣어도 되게 한 번 풀어서 쓴다
// (요청을 만들 때 encodeURIComponent 를 다시 적용하므로 Encoding 키를 그대로 쓰면 이중 인코딩으로 인증이 실패한다).
export function normalizeServiceKey(raw: string | undefined | null): string {
  const key = (raw ?? '').trim();
  if (!key) return '';
  if (/%[0-9A-Fa-f]{2}/.test(key)) { try { return decodeURIComponent(key); } catch { return key; } }
  return key;
}

// 점검용: 실패 이유까지 돌려준다(키 값은 절대 담지 않음). odcloud 오류 예 — HTTP 401 {code:-4,"등록되지 않은 인증키"}(오타·활성 전), {code:-401}(키 없음)
export async function probeBusinessStatus(brn: string): Promise<{ ok: true; result: BusinessStatusResult } | { ok: false; reason: string }> {
  const key = normalizeServiceKey(process.env.NTS_BUSINESS_API_KEY);
  const digits = brn.replace(/\D/g, '');
  if (!key) return { ok: false, reason: '키 미설정' };
  if (digits.length !== 10) return { ok: false, reason: '점검용 번호 형식 오류' };
  try {
    const res = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ b_no: [digits] }), cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null) as { code?: number; msg?: string; data?: Array<{ b_stt?: string; b_stt_cd?: string; tax_type?: string }> } | null;
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}${body?.code != null ? ` · 코드 ${body.code}` : ''}${body?.msg ? ` · ${String(body.msg).slice(0, 40)}` : ''}` };
    const row = body?.data?.[0];
    if (!row) return { ok: false, reason: '응답에 조회 결과 없음' };
    return { ok: true, result: { status: CODE[row.b_stt_cd ?? ''] ?? 'unknown', detail: [row.b_stt, row.tax_type].filter(Boolean).join(' · ') || '조회 결과 없음', checkedAt: new Date().toISOString() } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === 'TimeoutError' ? '8초 안에 응답 없음' : '접속 실패' };
  }
}

export async function checkBusinessStatus(brn: string): Promise<BusinessStatusResult | null> {
  const key = normalizeServiceKey(process.env.NTS_BUSINESS_API_KEY);
  const digits = brn.replace(/\D/g, '');
  if (!key || digits.length !== 10) return null;
  try {
    const res = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ b_no: [digits] }), cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: Array<{ b_stt?: string; b_stt_cd?: string; tax_type?: string }> };
    const row = json.data?.[0];
    if (!row) return null;
    const status = CODE[row.b_stt_cd ?? ''] ?? 'unknown';
    const detail = [row.b_stt, row.tax_type].filter(Boolean).join(' · ') || '조회 결과 없음';
    return { status, detail, checkedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
