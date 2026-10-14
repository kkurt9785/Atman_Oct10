import 'server-only';

// 국세청 사업자등록 상태조회 (공공데이터포털 '국세청_사업자등록정보 진위확인 및 상태조회 서비스').
// 키(NTS_BUSINESS_API_KEY)가 없으면 null 을 돌려 주고 호출한 쪽은 '미조회'로 둔다 — 운영자 확인은 그대로 남는다.
export type BusinessStatus = 'active' | 'suspended' | 'closed' | 'unknown';
export type BusinessStatusResult = { status: BusinessStatus; detail: string; checkedAt: string };

const CODE: Record<string, BusinessStatus> = { '01': 'active', '02': 'suspended', '03': 'closed' };
export const BUSINESS_STATUS_LABEL: Record<string, string> = { active: '계속사업자', suspended: '휴업', closed: '폐업', unknown: '미등록·조회 불가' };

export async function checkBusinessStatus(brn: string): Promise<BusinessStatusResult | null> {
  const key = process.env.NTS_BUSINESS_API_KEY;
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
