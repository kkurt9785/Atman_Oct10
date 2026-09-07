import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { userClient } from '@/lib/supabase';
import { fetchJsonWithTimeout, typeFromClCd } from '@/lib/hira';

// 사업장 검색: 잇닿 DB(초대코드 연결) + 카카오 로컬(즉시 등록, 지역어 인식·좌표).
// 심평원은 이름 검색이 4~5초라 검색 경로에서 빼고, 등록 시점에 좌표 반경 조회로 요양기관기호를 붙인다(lib/facility.ts).

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
  registeredFacilityId: string | null; // 이미 잇닿에 등록돼 있으면 그 id (초대코드 연결로 안내)
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

async function searchKakao(query: string, key: string): Promise<FacilitySearchHit[]> {
  const run = async (code: 'HP8' | 'PM9') => {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&category_group_code=${code}&size=10`;
    const data = await fetchJsonWithTimeout(url, { headers: { Authorization: `KakaoAK ${key}` }, timeoutMs: 5000 });
    const docs = (data as { documents?: Array<Record<string, string>> }).documents ?? [];
    return docs.map((d) => {
      const name = d.place_name ?? '';
      const { facilityType, typeLabel } = code === 'PM9' ? { facilityType: 'pharmacy', typeLabel: '약국' } : typeFromClCd(null, name);
      return {
        source: 'kakao' as const, id: `kakao:${d.id}`, name, facilityType, typeLabel,
        address: d.road_address_name || d.address_name || '', phone: d.phone || null,
        lng: num(d.x), lat: num(d.y), bedCount: null, hiraYkiho: null, hiraClCd: null, registeredFacilityId: null,
      };
    });
  };
  const [h, p] = await Promise.all([run('HP8'), run('PM9')]);
  return [...h, ...p];
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

  const kakaoKey = process.env.KAKAO_REST_API_KEY ?? process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY;
  const sources: Record<string, 'ok' | 'skipped' | 'error'> = {};
  const detail: Record<string, string> = {};
  const sb = userClient(session.accessToken);

  const dbPromise = (async () => {
    if (!sb) return [] as FacilitySearchHit[];
    const { data, error } = await sb.rpc('search_claimable_facilities', { p_query: q });
    if (error) throw error;
    return ((data ?? []) as Array<{ id: string; name: string; facility_type: string; address_text: string }>).map((f) => ({
      source: 'db' as const, id: f.id, name: f.name, facilityType: f.facility_type,
      typeLabel: DB_TYPE_LABEL[f.facility_type] ?? f.facility_type, address: f.address_text ?? '',
      phone: null, lng: null, lat: null, bedCount: null, hiraYkiho: null, hiraClCd: null, registeredFacilityId: f.id,
    }));
  })();
  const kakaoPromise = kakaoKey ? searchKakao(q, kakaoKey) : Promise.resolve(null);

  const [dbResult, kakaoResult] = await Promise.allSettled([dbPromise, kakaoPromise]);
  const dbHits = dbResult.status === 'fulfilled' ? dbResult.value : [];
  sources.db = dbResult.status === 'fulfilled' ? 'ok' : 'error';
  if (dbResult.status === 'rejected') detail.db = String((dbResult.reason as Error)?.message ?? dbResult.reason).slice(0, 160);

  let kakaoHits: FacilitySearchHit[] = [];
  if (kakaoResult.status === 'fulfilled' && kakaoResult.value === null) sources.kakao = 'skipped';
  else if (kakaoResult.status === 'fulfilled') { sources.kakao = 'ok'; kakaoHits = kakaoResult.value ?? []; }
  else { sources.kakao = 'error'; detail.kakao = String((kakaoResult.reason as Error)?.message ?? kakaoResult.reason).slice(0, 160); console.error('[facility-search] kakao', detail.kakao); }

  // 같은 이름이 DB(초대코드 연결)에 이미 있으면 카카오 카드는 뒤로 — 같은 사업장을 두 번 보여주지 않기 위한 최소 정리
  const dbNames = new Set(dbHits.map((d) => d.name.replace(/\s+/g, '')));
  const ordered = [...dbHits, ...kakaoHits.filter((k) => !dbNames.has(k.name.replace(/\s+/g, ''))), ...kakaoHits.filter((k) => dbNames.has(k.name.replace(/\s+/g, '')))];
  return NextResponse.json({ hits: ordered, sources, detail });
}
