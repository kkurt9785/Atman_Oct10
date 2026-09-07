// 심평원(HIRA) 병원정보서비스·약국정보서비스 클라이언트.
// 이름 검색은 4~5초로 느려서 검색 경로에는 쓰지 않고, 등록 시점에 좌표 반경 조회로 요양기관기호(ykiho)·종별을 붙이는 데 쓴다.
// 오류는 XML 본문으로 오는 경우가 있어 JSON 파싱 실패도 오류로 취급한다.

export type HiraKind = 'hospital' | 'pharmacy';
export type HiraFacility = {
  ykiho: string; name: string; clCd: string | null; clCdNm: string | null;
  facilityType: string; typeLabel: string; address: string; phone: string | null; lng: number | null; lat: number | null;
};

const HIRA_HOSP = process.env.HIRA_HOSP_ENDPOINT ?? 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList';
const HIRA_PHARM = process.env.HIRA_PHARM_ENDPOINT ?? 'https://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList';

// 심평원 종별코드 → 잇닿 facility_type (라벨은 claim 페이지 TYPE_LABEL과 맞춤)
export function typeFromClCd(clCd: string | null, name: string): { facilityType: string; typeLabel: string } {
  if (clCd === '28' || /요양병원/.test(name)) return { facilityType: 'care_hospital', typeLabel: '요양병원' };
  if (clCd === '01' || clCd === '11') return { facilityType: 'general_hospital', typeLabel: '종합병원' };
  return { facilityType: 'small_hospital', typeLabel: '병원·의원' };
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function fetchJsonWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    try { return JSON.parse(text); } catch { throw new Error(`non-JSON ${text.slice(0, 120).replace(/\s+/g, ' ')}`); }
  } finally { clearTimeout(timer); }
}

type HiraItem = Record<string, unknown>;
function hiraItems(payload: unknown): HiraItem[] {
  const header = (payload as { response?: { header?: { resultCode?: string; resultMsg?: string } } })?.response?.header;
  if (header?.resultCode && header.resultCode !== '00') throw new Error(`HIRA ${header.resultCode} ${header.resultMsg ?? ''}`);
  const items = (payload as { response?: { body?: { items?: { item?: HiraItem | HiraItem[] } } } })?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function toFacility(it: HiraItem, kind: HiraKind): HiraFacility | null {
  const name = String(it.yadmNm ?? '').trim();
  const ykiho = String(it.ykiho ?? '');
  if (!name || !ykiho) return null;
  const clCd = it.clCd == null ? null : String(it.clCd);
  const { facilityType, typeLabel } = kind === 'pharmacy' ? { facilityType: 'pharmacy', typeLabel: '약국' } : typeFromClCd(clCd, name);
  return {
    ykiho, name, clCd, clCdNm: it.clCdNm ? String(it.clCdNm) : null, facilityType, typeLabel,
    address: String(it.addr ?? '').trim(), phone: it.telno ? String(it.telno) : null, lng: num(it.XPos), lat: num(it.YPos),
  };
}

function hiraQuery(kind: HiraKind, key: string, params: Record<string, string>): string {
  const base = kind === 'hospital' ? HIRA_HOSP : HIRA_PHARM;
  const qs = new URLSearchParams({ _type: 'json', numOfRows: '20', pageNo: '1', ...params });
  return `${base}?serviceKey=${encodeURIComponent(key)}&${qs.toString()}`;
}

// 심평원은 간헐적으로 resultCode 99("Failed to setAutoCommit … pool connection")를 즉시 돌려준다 — 그 경우만 1회 재시도
async function hiraCall(url: string, timeoutMs: number): Promise<HiraItem[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return hiraItems(await fetchJsonWithTimeout(url, { timeoutMs }));
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error && /^HIRA 99/.test(error.message))) throw error;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function searchHiraByName(query: string, kind: HiraKind, key: string, timeoutMs = 8000): Promise<HiraFacility[]> {
  const items = await hiraCall(hiraQuery(kind, key, { yadmNm: query }), timeoutMs);
  return items.map((it) => toFacility(it, kind)).filter((f): f is HiraFacility => f !== null);
}

export async function findHiraNearby(kind: HiraKind, key: string, lng: number, lat: number, radiusMeters: number, timeoutMs = 8000): Promise<HiraFacility[]> {
  const items = await hiraCall(hiraQuery(kind, key, { xPos: String(lng), yPos: String(lat), radius: String(radiusMeters) }), timeoutMs);
  return items.map((it) => toFacility(it, kind)).filter((f): f is HiraFacility => f !== null);
}

// 이름 비교용 정규화: 공백·괄호·법인 수식어 제거. "학교법인 대우학원 아주대학교요양병원" ≈ "아주대학교요양병원"
export function normalizeFacilityName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/더블유/g, 'w').replace(/에스/g, 's').replace(/에이치/g, 'h').replace(/제이/g, 'j').replace(/케이/g, 'k')
    .replace(/(의료법인|학교법인|사회복지법인|재단법인|사단법인|주식회사|\(주\)|㈜)\s*[가-힣A-Za-z0-9]*(재단|학원|의료원|법인)?/g, '')
    .replace(/[\s·\-_.,'"]/g, '')
    .toLowerCase();
}

function distanceMeters(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const r = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

// 카카오 검색 결과(이름+좌표)에 대응하는 심평원 요양기관을 찾는다. 반경 안에서 이름이 포함 관계면 매칭, 여러 개면 가장 가까운 것.
export async function findHiraMatch(input: { name: string; phone?: string | null; lng: number; lat: number; kind: HiraKind; key: string; radiusMeters?: number; timeoutMs?: number }): Promise<{ match: HiraFacility | null; candidates: number; error?: string }> {
  try {
    const nearby = await findHiraNearby(input.kind, input.key, input.lng, input.lat, input.radiusMeters ?? 150, input.timeoutMs ?? 8000);
    const target = normalizeFacilityName(input.name);
    const targetPhone = (input.phone ?? '').replace(/\D/g, '').replace(/^0/, '');
    const scored = nearby
      .map((f) => {
        const n = normalizeFacilityName(f.name);
        const nameHit = n === target || n.includes(target) || target.includes(n);
        // 한글 표기 차이("더블유여성병원" vs "W여성병원")는 전화번호 일치로 보강
        const fPhone = (f.phone ?? '').replace(/\D/g, '').replace(/^0/, '');
        const phoneHit = targetPhone.length >= 8 && fPhone.length >= 8 && (fPhone === targetPhone || fPhone.endsWith(targetPhone.slice(-8)));
        const dist = f.lng != null && f.lat != null ? distanceMeters(input.lng, input.lat, f.lng, f.lat) : Number.POSITIVE_INFINITY;
        return { f, hit: nameHit || phoneHit, dist };
      })
      .filter((s) => s.hit)
      .sort((a, b) => a.dist - b.dist);
    return { match: scored[0]?.f ?? null, candidates: nearby.length };
  } catch (error) {
    return { match: null, candidates: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
