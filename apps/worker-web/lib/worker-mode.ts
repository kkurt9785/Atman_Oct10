import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// 워커 앱은 두 제품을 한 도메인에서 서비스한다.
//   - 의료 워커 셸: 병원·약국 시프트 탐색·지원, 직원 근태(/home /shifts /applications /workplace /workroom /earnings /settings /notifications)
//   - 긱워커 셸:   초대받은 단기 근무지의 출퇴근·워크룸만(/gig/*)
// 어느 셸을 보여 줄지는 이 파일 하나가 정한다. 화면에서 registration_source 나 localStorage 를 직접 읽지 않는다.

export const GIGWORKER_SOURCE = 'gigworker_trial';
export const GIGWORKER_MODE_KEY = 'atman_gigworker_mode';
export const WORKER_MODE_CHANGED_EVENT = 'atman:worker-mode-changed';

export type WorkerShell = 'gig' | 'medical';
export const WORKER_SHELL_HOME: Record<WorkerShell, string> = { gig: '/gig', medical: '/home' };

// 로그인이 필요한 의료 워커 셸 경로. 긱워커만 쓰는 사람이 오면 /gig 로 보낸다.
// /shifts /map /jobs 는 비로그인 둘러보기 페이지라 가드하지 않고, /workplace/join 은 초대 수락이라 JoinInvite 가 스스로 라우팅한다.
const MEDICAL_SHELL_PREFIXES = ['/home', '/applications', '/earnings', '/rewards', '/settings', '/notifications', '/workplace', '/workroom', '/chat', '/store'];

export function isMedicalShellPath(path: string) {
  if (path.startsWith('/workplace/join')) return false;
  return MEDICAL_SHELL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

type FacilityRelation = { id?: string; registration_source?: string | null };
type StaffLinkRelation = { id?: string; facilities?: FacilityRelation | FacilityRelation[] | null };

export function facilityOfLink(row: unknown): FacilityRelation | null {
  const facilities = (row as StaffLinkRelation)?.facilities;
  return (Array.isArray(facilities) ? facilities[0] : facilities) ?? null;
}

export function getFacilityRegistrationSources(rows: unknown[] | null | undefined) {
  return (rows ?? []).flatMap((row) => {
    const source = facilityOfLink(row)?.registration_source;
    return source ? [source] : [];
  });
}

export function isGigworkerSource(source: string | null | undefined) {
  return source === GIGWORKER_SOURCE;
}

export function hasGigworkerLink(sources: string[]) {
  return sources.some(isGigworkerSource);
}

// 'other' 는 근태 초대로 간편 가입한 사람의 직군이라 의료 워커라는 근거가 못 된다.
export function isMedicalRole(role: string | null | undefined) {
  return Boolean(role) && role !== 'other';
}

// 의료 셸을 쓸 이유가 하나라도 있는가 — 병원·약국 직원으로 연결됐거나 의료 직군으로 등록했거나.
export function hasMedicalContext(sources: string[], role: string | null | undefined) {
  return sources.some((source) => !isGigworkerSource(source)) || isMedicalRole(role);
}

export function getGigworkerModePreference() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(GIGWORKER_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setGigworkerModePreference(enabled: boolean) {
  if (typeof window === 'undefined') return;
  // 같은 값이면 아무 일도 하지 않는다 — 셸 가드가 화면마다 호출하므로, 여기서 캐시를 비우면 매 화면 이동이 재조회가 된다
  if (getGigworkerModePreference() === enabled) return;
  try {
    if (enabled) window.localStorage.setItem(GIGWORKER_MODE_KEY, '1');
    else window.localStorage.removeItem(GIGWORKER_MODE_KEY);
  } catch {
    // 저장이 막힌 브라우저에서도 셸 판단은 계속된다 (서버 데이터 기준으로 폴백)
  }
  window.dispatchEvent(new Event(WORKER_MODE_CHANGED_EVENT));
  invalidateWorkerShellContext();
}

// 마지막으로 쓴 셸을 기억한다. 두 제품을 다 쓰는 사람이 앱을 다시 열 때만 이 값이 쓰인다.
export function rememberWorkerShell(shell: WorkerShell) {
  setGigworkerModePreference(shell === 'gig');
}

// 셸 판정 규칙 (우선순위 순)
//   1. 긱 근무지가 없으면 항상 의료 셸
//   2. 긱 근무지만 있고 의료 쪽 근거가 없으면 항상 긱 셸
//   3. 둘 다 있으면 마지막으로 쓴 셸
export function resolveWorkerShell(
  sources: string[],
  role: string | null | undefined,
  preferred = getGigworkerModePreference(),
): WorkerShell {
  if (!hasGigworkerLink(sources)) return 'medical';
  if (!hasMedicalContext(sources, role)) return 'gig';
  return preferred ? 'gig' : 'medical';
}

export type WorkerShellContext = {
  user: User;
  role: string | null;
  sources: string[];
  hasGig: boolean;
  hasMedical: boolean;
  shell: WorkerShell;
  // 알림·워크룸을 셸별로 나눌 때 쓴다 (facility_staff.id / facilities.id)
  gigStaffIds: string[];
  gigFacilityIds: string[];
};

let contextCache: { at: number; promise: Promise<WorkerShellContext | null> } | null = null;
const CONTEXT_TTL_MS = 15_000;

export function invalidateWorkerShellContext() {
  contextCache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('atman:workplace-linked', invalidateWorkerShellContext);
}

async function fetchWorkerShellContext(knownUser?: User | null): Promise<WorkerShellContext | null> {
  const user = knownUser ?? (await supabase.auth.getUser()).data.user;
  if (!user) return null;
  const [{ data: staffLinks }, { data: worker }] = await Promise.all([
    supabase.from('facility_staff').select('id,facilities(id,registration_source)').neq('status', 'ended'),
    supabase.from('workers').select('role').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
  ]);
  const links = (staffLinks ?? []) as StaffLinkRelation[];
  const sources = getFacilityRegistrationSources(links);
  const role = worker?.role ?? null;
  const gigLinks = links.filter((link) => isGigworkerSource(facilityOfLink(link)?.registration_source));
  const gigStaffIds = gigLinks.map((link) => link.id).filter((id): id is string => Boolean(id));
  const gigFacilityIds = [...new Set(gigLinks.map((link) => facilityOfLink(link)?.id).filter((id): id is string => Boolean(id)))];
  return {
    user,
    role,
    sources,
    hasGig: hasGigworkerLink(sources),
    hasMedical: hasMedicalContext(sources, role),
    shell: resolveWorkerShell(sources, role),
    gigStaffIds,
    gigFacilityIds,
  };
}

// 로그인한 워커의 셸 판단 재료를 한 번에 가져온다. 셸 안에서 화면을 옮길 때마다 다시 묻지 않도록 잠깐 캐시한다.
export function loadWorkerShellContext(knownUser?: User | null) {
  const now = Date.now();
  if (contextCache && now - contextCache.at < CONTEXT_TTL_MS) return contextCache.promise;
  const promise = fetchWorkerShellContext(knownUser).catch((error) => {
    contextCache = null;
    throw error;
  });
  contextCache = { at: now, promise };
  return promise;
}
