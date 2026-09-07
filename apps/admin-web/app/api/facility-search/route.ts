import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { userClient } from '@/lib/supabase';

// 사업장 검색: 잇닿 DB(초대코드 연결) + 심평원 병원·약국(즉시 등록) + 카카오 로컬(심평원 0건 폴백).
// 서비스키는 서버에만 둔다. 각 소스는 독립 실패 — 하나가 죽어도 나머지는 돌려준다.

export type FacilitySearchHit = {
  source: 'db' | 'hira' | 'kakao';
  id: string;                 // db: facility id / hira: ykiho / kakao: place id
  name: string;
  facilityType: string;       // small_hospital | general_hospital | care_hospital | pharmacy
  typeLabel: string;
  address: string;
  phone: string | null;
  lng: number | null;
  lat: number | null;
  bedCount: number | null;
  hiraYkiho: string | null;
  hiraClCd: string | null;
  registeredFacilityId: string | null; // 심평원 결과가 이미 잇닿에 등록돼 있으면 그 id
};

const HIRA_HOSP = process.env.HIRA_HOSP_ENDPOINT ?? 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList';
const HIRA_PHARM = process.env.HIRA_PHARM_ENDPOINT ?? 'https://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList';

// 심평원 종별코드 → 잇닿 facility_type (라벨은 claim 페이지 TYPE_LABEL과 맞춤)
function typeFromClCd(clCd: string | null, name: string): { facilityType: string; typeLabel: string } {
  if (clCd === '28' || /요양병원/.test(name)) return { facilityType: 'care_hospital', typeLabel: '요양병원' };
  if (clCd === '01' || clCd === '11') return { facilityType: 'general_hospital', typeLabel: '종합병원' };
  return { facilityType: 'small_hospital', typeLabel: '병원·의원' };
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 6000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

type HiraItem = Record<string, unknown>;
function hiraItems(payload: unknown): HiraItem[] {
  const items = (payload as { response?: { body?: { items?: { item?: HiraItem | HiraItem[] } } } })?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function searchHira(query: string, kind: 'hospital' | 'pharmacy', key: string): Promise<FacilitySearchHit[]> {
  const base = kind === 'hospital' ? HIRA_HOSP : HIRA_PHARM;
  const url = `${base}?serviceKey=${encodeURIComponent(key)}&_type=json&numOfRows=20&pageNo=1&yadmNm=${encodeURIComponent(query)}`;
  const items = hiraItems(await fetchJson(url));
  return items.map((it) => {
    const name = String(it.yadmNm ?? '').trim();
    const clCd = it.clCd == null ? null : String(it.clCd);
    const { facilityType, typeLabel } = kind === 'pharmacy'
      ? { facilityType: 'pharmacy', typeLabel: '약국' }
      : typeFromClCd(clCd, name);
    return {
      source: 'hira' as const,
      id: String(it.ykiho ?? ''),
      name,
      facilityType, typeLabel,
      address: String(it.addr ?? '').trim(),
      phone: it.telno ? String(it.telno) : null,
      lng: num(it.XPos), lat: num(it.YPos),
      bedCount: null,
      hiraYkiho: it.ykiho ? String(it.ykiho) : null,
      hiraClCd: clCd,
      registeredFacilityId: null,
    };
  }).filter((h) => h.id && h.name);
}

async function searchKakao(query: string, key: string): Promise<FacilitySearchHit[]> {
  const run = async (code: 'HP8' | 'PM9') => {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&category_group_code=${code}&size=10`;
    const data = await fetchJson(url, { headers: { Authorization: `KakaoAK ${key}` } });
    const docs = (data as { documents?: Array<Record<string, string>> }).documents ?? [];
    return docs.map((d) => {
      const name = d.place_name ?? '';
      const isPharmacy = code === 'PM9';
      const { facilityType, typeLabel } = isPharmacy ? { facilityType: 'pharmacy', typeLabel: '약국' } : typeFromClCd(null, name);
      return {
        source: 'kakao' as const,
        id: `kakao:${d.id}`,
        name,
        facilityType, typeLabel,
        address: d.road_address_name || d.address_name || '',
        phone: d.phone || null,
        lng: num(d.x), lat: num(d.y),
        bedCount: null, hiraYkiho: null, hiraClCd: null, registeredFacilityId: null,
      };
    });
  };
  const [h, p] = await Promise.allSettled([run('HP8'), run('PM9')]);
  return [...(h.status === 'fulfilled' ? h.value : []), ...(p.status === 'fulfilled' ? p.value : [])];
}

const DB_TYPE_LABEL: Record<string, string> = {
  care_hospital: '요양병원', general_hospital: '종합병원', small_hospital: '병원·의원',
  nursing_home: '요양원', home_health: '방문간호', pharmacy: '약국',
};

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ hits: [], sources: {} });

  const hiraKey = process.env.HIRA_SERVICE_KEY;
  const kakaoKey = process.env.KAKAO_REST_API_KEY ?? process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY;
  const sources: Record<string, 'ok' | 'skipped' | 'error'> = {};

  // 1) 잇닿 DB — 초대코드로 연결하는 기존 경로
  const sb = userClient(session.accessToken);
  const dbPromise = (async () => {
    if (!sb) return [] as FacilitySearchHit[];
    const { data, error } = await sb.rpc('search_claimable_facilities', { p_query: q });
    if (error) throw error;
    return ((data ?? []) as Array<{ id: string; name: string; facility_type: string; address_text: string; hira_ykiho?: string | null }>).map((f) => ({
      source: 'db' as const, id: f.id, name: f.name, facilityType: f.facility_type,
      typeLabel: DB_TYPE_LABEL[f.facility_type] ?? f.facility_type, address: f.address_text ?? '',
      phone: null, lng: null, lat: null, bedCount: null, hiraYkiho: f.hira_ykiho ?? null, hiraClCd: null, registeredFacilityId: f.id,
    }));
  })();

  // 2) 심평원 병원 + 약국 (키 없으면 skipped)
  const hiraPromise = hiraKey
    ? Promise.allSettled([searchHira(q, 'hospital', hiraKey), searchHira(q, 'pharmacy', hiraKey)])
    : Promise.resolve(null);

  const [dbResult, hiraResult] = await Promise.all([dbPromise.then((v) => ({ ok: true as const, v })).catch(() => ({ ok: false as const, v: [] as FacilitySearchHit[] })), hiraPromise]);
  sources.db = dbResult.ok ? 'ok' : 'error';
  const dbHits = dbResult.v;

  let hiraHits: FacilitySearchHit[] = [];
  if (hiraResult === null) sources.hira = 'skipped';
  else {
    const okParts = hiraResult.filter((r): r is PromiseFulfilledResult<FacilitySearchHit[]> => r.status === 'fulfilled');
    sources.hira = okParts.length ? 'ok' : 'error';
    hiraHits = okParts.flatMap((r) => r.value);
  }

  // 3) 심평원이 비었을 때만 카카오 폴백 (좌표는 있으나 요양기관기호 없음)
  let kakaoHits: FacilitySearchHit[] = [];
  if (hiraHits.length === 0 && kakaoKey) {
    try { kakaoHits = await searchKakao(q, kakaoKey); sources.kakao = 'ok'; } catch { sources.kakao = 'error'; }
  } else sources.kakao = 'skipped';

  // 4) 병합: 이미 잇닿에 등록된 심평원 기관은 '등록'이 아니라 '초대코드 연결'로 안내
  const registeredByYkiho = new Map(dbHits.filter((d) => d.hiraYkiho).map((d) => [d.hiraYkiho as string, d.id]));
  const ykihos = hiraHits.map((h) => h.hiraYkiho).filter((v): v is string => Boolean(v));
  if (sb && ykihos.length) {
    const { data } = await sb.rpc('find_registered_hira_facilities', { p_ykihos: ykihos });
    for (const r of (data ?? []) as Array<{ hira_ykiho: string; facility_id: string }>) registeredByYkiho.set(r.hira_ykiho, r.facility_id);
  }
  const external = [...hiraHits, ...kakaoHits].map((h) => ({
    ...h,
    registeredFacilityId: h.hiraYkiho ? registeredByYkiho.get(h.hiraYkiho) ?? null : null,
  }));
  // DB 검색 결과에 이미 나온 ykiho만 외부 결과에서 제거 (등록됐지만 DB 검색에 안 잡힌 기관은 '초대코드 연결' 카드로 남긴다)
  const dbYkihos = new Set(dbHits.map((d) => d.hiraYkiho).filter(Boolean));
  const dedup = external.filter((h) => !(h.hiraYkiho && dbYkihos.has(h.hiraYkiho)));

  return NextResponse.json({ hits: [...dbHits, ...dedup], sources });
}
