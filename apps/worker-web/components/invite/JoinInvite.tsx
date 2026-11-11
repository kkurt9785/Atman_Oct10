'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loadWorkerShellContext, rememberWorkerShell } from '@/lib/worker-mode';
import { inviteFailureAction } from '@/lib/invite-failure';
import { WorkerModeBadge } from '@/components/worker/WorkerModeBadge';
import { Wordmark } from '@/components/brand/BrandMark';
import { BackButton } from '@/components/BackButton';
import { demoKindOf, leaveDemo, type DemoKind } from '@/lib/demo-session';
import { DemoEndSheet } from '@/components/DemoSignup';
import { LINKED_NOTICE_KEY } from '@/components/invite/LinkedNotice';
import { LINKED_INSTALL_KEY } from '@/lib/linked-install';
import { startKakaoLogin } from '@/lib/kakao-login';
import { clearInviteAutoclaim, hasInviteAutoclaim, isClaimedInvite, rememberClaimedInvite, rememberInviteAutoclaim } from '@/lib/invite-autoclaim';
import { detectBrowser, isStandaloneApp, openKakaoExternallyOnce } from '@/lib/in-app-browser';
import { PwaInstallSheet } from '@/components/PwaInstallSheet';

// 근무 초대 수락 화면. 긱워커(/gig/join)와 사업장 직원(/workplace/join) 두 라우트가 같은 흐름
// (미리보기 → 카카오 가입 → claim)을 쓰되, 초대가 어느 제품 것인지는 서버(isGigworker)가 정한다.
// 라우트와 초대 종류가 어긋나면 맞는 라우트로 보낸다 — 이미 발송된 옛 링크가 계속 동작해야 한다.

export type JoinVariant = 'gig' | 'medical';

type InvitePreview = {
  ok: boolean;
  reason?: string;
  message?: string;
  isGigworker?: boolean;
  facilityName?: string;
  facilityAddress?: string | null;
  workerName?: string;
  role?: string | null;
  workDescription?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  workWeekdays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number | null;
  payBasis?: string | null;
  payRate?: number | null;
  payHidden?: boolean;
  phoneLast4?: string;
  expiresAt?: string;
};

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const PAY_BASIS: Record<string, string> = { hourly: '시급', daily: '일급', monthly: '월급' };
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const ROUTES: Record<JoinVariant, { join: string; home: string; settings: string }> = {
  gig: { join: '/gig/join', home: '/gig', settings: '/gig/settings' },
  medical: { join: '/workplace/join', home: '/workplace', settings: '/settings' },
};
const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

function dateRange(preview: InvitePreview) {
  if (!preview.contractStart && !preview.contractEnd) return '기간 협의';
  if (preview.contractStart === preview.contractEnd) return preview.contractStart ?? '기간 협의';
  return `${preview.contractStart ?? '시작일 협의'} ~ ${preview.contractEnd ?? '종료일 협의'}`;
}

function weekdayText(days?: number[] | null) {
  return (days ?? []).filter((day) => day >= 1 && day <= 7).map((day) => WEEKDAYS[day - 1]).join('·') || '요일 협의';
}

// 초대 근무(팝업·행사 알바)를 보낸 사람은 '사장님', 병원·약국 직원 초대는 '관리자'로 부른다
function friendlyInviteError(message: string, isGig: boolean) {
  return message
    .replace(/^.*?: /, '')
    .replace('병원이 등록한 연락처', isGig ? '사장님이 등록한 연락처' : '관리자가 등록한 연락처')
    .replace('이 병원의 다른 직원 정보', '이 근무지의 다른 근무자 정보')
    .replace('병원에 재발급', isGig ? '사장님께 재발급' : '관리자에게 재발급');
}

export function JoinInvite({ variant }: { variant: JoinVariant }) {
  const params = useSearchParams();
  const token = params.get('token');
  const routes = ROUTES[variant];
  const isGig = variant === 'gig';
  const [status, setStatus] = useState<'loading' | 'preview' | 'claiming' | 'success' | 'error'>('loading');
  const [demoEnd, setDemoEnd] = useState<DemoKind | null>(null);
  const [demoBlocked, setDemoBlocked] = useState(false);
  // 시연 사업장 초대를 실제 계정(또는 로그인 전)으로 열었을 때 — 시연 입구로 안내
  const [demoOnly, setDemoOnly] = useState(false);
  const [message, setMessage] = useState('근무 초대를 확인하고 있어요...');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [hasWorker, setHasWorker] = useState(false);
  // 긱 초대: 수락하면 등록된 지급 계좌가 이 근무지에 전달된다 — 시작할 때 이미 전달돼 있어야 워커가 안심한다
  const [bankLabel, setBankLabel] = useState<string | null>(null);
  const [inKakaoTalk, setInKakaoTalk] = useState(false);
  // 아이폰 사파리·크롬에서 연 초대 — 홈 화면 앱은 사파리 로그인을 넘겨받지 못해서, 앱을 먼저 추가하고 앱 안에서 한 번만 로그인하게 권한다
  const [iosBrowser, setIosBrowser] = useState(false);
  const [kakaoIos, setKakaoIos] = useState(false);
  const [installGuide, setInstallGuide] = useState(false);
  // 설치 시트를 한 번 봤으면 — 아이폰은 '설치됨' 신호가 없어서, 그 뒤로는 '홈 화면 아이콘으로 열기' 안내를 고정으로 보여 준다
  const [installGuideSeen, setInstallGuideSeen] = useState(false);
  useEffect(() => {
    const kakao = navigator.userAgent.includes('KAKAO');
    setInKakaoTalk(kakao);
    const browser = detectBrowser(navigator.userAgent, navigator.maxTouchPoints);
    setIosBrowser((browser.safari || browser.chromeIos) && !isStandaloneApp());
    setKakaoIos(browser.ios);
    // 카카오톡 안에서는 로그인도 홈 화면 추가도 안 된다 — 열리자마자 사파리·크롬으로 넘긴다(돌아와서 다시 그려지면 아래 버튼으로)
    if (kakao) openKakaoExternallyOnce();
  }, []);
  const [retry,setRetry]=useState(0);
  const [canRetry,setCanRetry]=useState(false);
  const claiming=useRef(false);
  // 초대 자동 수락은 화면당 한 번만 (StrictMode 이중 실행·다시 불러오기에도)
  const autoClaimTried=useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      setStatus('loading');setCanRetry(false);setDemoBlocked(false);setDemoOnly(false);setMessage('근무 초대를 확인하고 있어요...');
      try {
      if (!token) {
        setStatus('error');
        setMessage(`초대 링크가 올바르지 않아요. ${isGig ? '사장님께' : '관리자에게'} 새 링크를 요청해 주세요.`);
        return;
      }
      // 이 기기에서 이미 수락한 초대 — 초대 화면에서 추가한 홈 화면 앱은 열 때마다 여기서 시작한다. 바로 내 근무로
      if (isClaimedInvite(token)) { window.location.replace(ROUTES[variant].home); return; }

      const [{ data: previewData, error: previewError }, { data: { user },error:authError }] = await Promise.all([
        supabase.rpc('get_facility_staff_invite_preview', { p_token: token }),
        supabase.auth.getUser(),
      ]);
      if (!active) return;

      const invite = previewData as InvitePreview | null;
      if(previewError)throw previewError;
      if(authError&&authError.name!=='AuthSessionMissingError')throw authError;
      if (!invite?.ok) {
        clearInviteAutoclaim();
        // 이미 수락한 초대를 다시 연 사람(홈 화면 앱이 이 주소에서 시작한다)은 실패 화면이 아니라 내 근무로 보낸다.
        // 서버는 '쓴 초대'와 '없는 초대'를 구분해 주지 않아, 이 종류의 근무지에 이미 연결돼 있는지로 판단한다(lib/invite-failure.ts)
        const context = user ? await loadWorkerShellContext(user).catch(() => null) : null;
        if (!active) return;
        const action = inviteFailureAction({ reason: invite?.reason, signedIn: Boolean(user), linked: Boolean(isGig ? context?.hasGig : context?.staffFirst) });
        if (action === 'open_home') {
          rememberClaimedInvite(token);
          rememberWorkerShell(variant);
          window.location.replace(ROUTES[variant].home);
          return;
        }
        setSignedIn(Boolean(user));
        setDemoOnly(invite?.reason === 'DEMO_ONLY');
        setStatus('error');
        setMessage(action === 'ask_login'
          ? `초대 링크가 만료됐거나 주소가 잘못됐어요. ${isGig ? '사장님께' : '근무지 관리자에게'} 새 초대 링크를 요청해 주세요.`
          : invite?.message ?? `초대 정보를 불러오지 못했어요. ${isGig ? '사장님께' : '근무지 관리자에게'} 새 링크를 요청해 주세요.`);
        return;
      }

      // 초대 종류와 라우트가 다르면 맞는 쪽으로 — 긱워커 초대는 /gig 셸, 사업장 직원 초대는 의료 워커 셸에서 수락한다.
      const expected = invite.isGigworker ? 'gig' : 'medical';
      if (expected !== variant) {
        window.location.replace(`${ROUTES[expected].join}?token=${encodeURIComponent(token)}`);
        return;
      }

      let workerExists = false;
      if (user) {
        const [{ data: worker,error:workerError }, { data: bank,error:bankError }] = await Promise.all([
          supabase.from('workers').select('id').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
          invite.isGigworker ? supabase.from('worker_bank_accounts').select('bank_name,account_number_last4').eq('is_primary', true).is('deleted_at', null).maybeSingle() : Promise.resolve({ data: null,error:null }),
        ]);
        if(workerError||bankError)throw workerError??bankError;
        workerExists = Boolean(worker?.id);
        if (active) setBankLabel(bank?.bank_name && bank.account_number_last4 ? `${bank.bank_name} ****${bank.account_number_last4}` : null);
      }
      if (!active) return;
      setPreview(invite);
      // 초대를 연 셸을 기억한다 — 가입·수락 뒤 앱을 다시 열면 이 셸로 온다
      rememberWorkerShell(variant);
      setSignedIn(Boolean(user));
      setHasWorker(workerExists);
      setStatus('preview');
      setMessage('아래 근무 조건을 확인한 뒤 초대를 수락해 주세요. 전화번호나 카카오 친구 추가는 필요 없어요.');
      } catch {if(active){setStatus('error');setCanRetry(true);setMessage('초대 정보를 확인하지 못했어요. 연결 상태를 확인하고 다시 불러와 주세요.');}}
    })();
    return () => { active = false; };
  }, [token, variant, isGig, retry]);

  function startRegistration() {
    if (!token) return;
    rememberWorkerShell(variant);
    window.localStorage.setItem('atman_auth_next', `${routes.join}?token=${encodeURIComponent(token)}`);
    // 이미 '수락'을 눌렀으니 가입을 마치고 이 화면으로 돌아오면 같은 초대를 자동으로 수락한다(초대 근무·사업장 직원 초대 공통)
    rememberInviteAutoclaim(token);
    // 초대 화면에서 이미 카카오 계속하기를 눌렀으므로 온보딩 스플래시에서 같은 버튼을 다시 묻지 않는다.
    if (!signedIn) { startKakaoLogin(); return; }
    window.location.href = '/onboarding?step=terms';
  }

  // 실패 화면에서 로그인 — 이미 수락한 사람은 로그인만 하면 내 근무가 열린다(근무 찾기 첫 화면을 거치지 않는다)
  function loginToMyWork() {
    rememberWorkerShell(variant);
    window.localStorage.setItem('atman_auth_next', routes.home);
    startKakaoLogin();
  }

  async function claimInvite(auto = false) {
    if (!token || claiming.current) return;
    if (!signedIn || !hasWorker) {
      startRegistration();
      return;
    }
    claiming.current=true;
    setCanRetry(false);
    setStatus('claiming');
    setMessage(auto ? '아까 누른 초대를 이어서 수락하고 있어요...' : '근무 초대를 연결하고 있어요...');
    try {
    const { data: staffId, error } = await supabase.rpc('claim_facility_staff_invite', { p_token: token });
    if (error) {
      setStatus('error');
      setMessage(friendlyInviteError(error.message, isGig));
      setCanRetry(true);
      // 시연 계정으로 실제 초대를 열었으면 시연을 끝내고 같은 초대를 내 계정으로 받게 한다
      setDemoBlocked(error.message.includes('시연 계정으로는 실제 초대'));
      return;
    }
    let bank: 'shared' | 'missing' | null = null;
    if (isGig && typeof staffId === 'string') {
      // 계좌가 있으면 지금 전달한다. 없으면 근무 화면 안내에서 근태·지급 탭으로 잇는다
      const { error: shareError } = await supabase.rpc('share_my_gig_bank_account', { p_staff_id: staffId });
      bank = shareError ? 'missing' : 'shared';
      // 수락한 시점의 근무 조건(시급·시간·휴게·기간)을 남긴다 — 뒤에 조건이 바뀌어도 '수락한 조건'을 다시 볼 수 있게
      await supabase.rpc('snapshot_my_gig_terms', { p_staff_id: staffId }).then(() => undefined, () => undefined);
    }
    rememberWorkerShell(variant);
    rememberClaimedInvite(token);
    window.dispatchEvent(new Event('atman:workplace-linked'));
    // 완료 화면을 거치지 않고 바로 근무 화면(출근하기)으로 — 연결 안내는 거기서 한 번 보여 준다
    try {
      window.sessionStorage.setItem(LINKED_NOTICE_KEY, JSON.stringify({ facility: preview?.facilityName ?? '근무지', bank, bankLabel }));
      window.sessionStorage.setItem(LINKED_INSTALL_KEY, String(Date.now()));
    } catch { /* 안내 없이 진행 */ }
    window.location.replace(routes.home);
    setStatus('success');
    setMessage(`${preview?.facilityName ? `${preview.facilityName} ` : ''}근무지와 이어졌어요. 출퇴근은 근무지에서 '출근하기'·'퇴근하기' 버튼으로 기록해요.`);
    } catch {setStatus('error');setCanRetry(true);setMessage('연결 결과를 확인하지 못했어요. 이미 연결됐을 수 있으니 내 근무를 먼저 확인하거나 초대를 다시 불러와 주세요.');}
    finally {claiming.current=false;}
  }

  // '가입하고 초대 수락'을 누른 뒤 가입·로그인을 마치고 돌아오면 버튼을 또 누르지 않아도 그 초대를 수락한다.
  // 표시는 그 토큰에만 남고(다른 초대·만료 표시는 hasInviteAutoclaim 이 지운다), 시도 전에 지워 성공·실패와 무관하게 한 번만 돈다.
  useEffect(() => {
    if (!token || status !== 'preview' || autoClaimTried.current) return;
    if (!hasInviteAutoclaim(token)) return;
    if (!signedIn || !hasWorker) return; // 아직 가입 전 — 버튼을 다시 누르면 표시가 새로 남는다
    autoClaimTried.current = true;
    clearInviteAutoclaim();
    void claimInvite(true);
    // claimInvite 는 이 렌더의 preview·bankLabel 을 쓴다 — 미리보기를 다 받은 뒤(status=preview)에만 부른다
  }, [token, status, signedIn, hasWorker]);

  // 초대 화면에서 나가기 — 시연 계정이면 로그아웃 대신 '시연을 끝낼까요?'(가입으로 잇기), 아니면 처음 화면(로그인돼 있으면 내 홈)으로
  async function leaveInvite() {
    const { data: { session } } = await supabase.auth.getSession();
    const kind = demoKindOf(session?.user.email);
    if (kind) { setDemoEnd(kind); return; }
    window.location.replace('/');
  }

  const payText = preview?.payBasis && preview.payRate
    ? `${PAY_BASIS[preview.payBasis] ?? preview.payBasis} ${won(preview.payRate)}`
    : null;

  return <main className={`min-h-screen px-5 pb-16 pt-8 [@media(max-height:700px)]:pt-4 ${isGig ? 'bg-gradient-to-b from-primary/15 via-bg to-bg' : 'bg-bg'}`}>
    <div className="mx-auto mb-5 [@media(max-height:700px)]:mb-3 flex max-w-md items-center justify-between gap-3 px-1"><span className="flex items-center gap-1"><BackButton href="/" onClick={leaveInvite} /><Wordmark size={20} /></span><WorkerModeBadge shell={variant} staffFirst={!isGig} /></div>
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 [@media(max-height:700px)]:p-5 shadow-card">
      <div className={`flex h-12 w-12 [@media(max-height:700px)]:hidden items-center justify-center rounded-full text-xl ${status === 'success' ? 'bg-emerald-50 text-emerald-600' : status === 'error' ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}>{status === 'success' ? '✓' : status === 'error' ? '!' : '↗'}</div>
      <p className="mt-5 [@media(max-height:700px)]:mt-0 text-[13px] font-bold text-primary">{isGig ? '초대 근무' : '직원 계정 연결'}</p>
      <h1 className="mt-1 text-[24px] font-extrabold">{status === 'success' ? '이어졌어요 · 이제 함께 일해요' : status === 'error' ? '초대를 열지 못했어요' : '초대받은 근무를 확인해 주세요'}</h1>
      <p role="status" className="mt-3 [@media(max-height:700px)]:mt-2 text-[14px] leading-6 [@media(max-height:700px)]:text-[13px] [@media(max-height:700px)]:leading-5 text-sub">{message}</p>

      {preview && status !== 'success' && <div className="mt-5 [@media(max-height:700px)]:mt-3 overflow-hidden rounded-2xl border border-line">
        <div className="bg-primary/5 px-4 py-4 [@media(max-height:700px)]:py-3">
          <p className="text-[18px] font-extrabold text-ink">{preview.facilityName}</p>
          {preview.facilityAddress && <p className="mt-1 text-[12px] leading-5 text-sub">{preview.facilityAddress}</p>}
        </div>
        <dl className="divide-y divide-line px-4 text-[13px]">
          <div className="flex justify-between gap-4 py-3 [@media(max-height:700px)]:py-2"><dt className="shrink-0 text-sub">등록 이름</dt><dd className="text-right font-bold text-ink">{preview.workerName}</dd></div>
          <div className="flex justify-between gap-4 py-3 [@media(max-height:700px)]:py-2"><dt className="shrink-0 text-sub">근무 기간</dt><dd className="text-right font-bold text-ink">{dateRange(preview)}</dd></div>
          <div className="flex justify-between gap-4 py-3 [@media(max-height:700px)]:py-2"><dt className="shrink-0 text-sub">근무 일정</dt><dd className="text-right font-bold text-ink">{weekdayText(preview.workWeekdays)} · {preview.startTime?.slice(0, 5) ?? '시간 협의'}~{preview.endTime?.slice(0, 5) ?? ''}</dd></div>
          {preview.workDescription && <div className="flex justify-between gap-4 py-3 [@media(max-height:700px)]:py-2"><dt className="shrink-0 text-sub">업무</dt><dd className="text-right font-bold text-ink">{preview.workDescription}</dd></div>}
          {payText && <div className="flex justify-between gap-4 py-3 [@media(max-height:700px)]:py-2"><dt className="shrink-0 text-sub">급여 조건</dt><dd className="text-right font-bold text-ink">{payText}</dd></div>}
          {!payText && preview.payHidden && <div className="flex justify-between gap-4 py-3 [@media(max-height:700px)]:py-2"><dt className="shrink-0 text-sub">급여 조건</dt><dd className="text-right text-[12px] text-sub">로그인하면 확인할 수 있어요</dd></div>}
          {preview.phoneLast4 && <div className="flex justify-between gap-4 py-3 [@media(max-height:700px)]:py-2"><dt className="shrink-0 text-sub">{isGig ? '사장님이 적은 연락처' : '관리자 메모 연락처'}</dt><dd className="text-right font-bold text-ink">끝 4자리 {preview.phoneLast4}<span className="ml-1 block text-[10px] font-medium text-sub">계정 인증에는 사용하지 않아요</span></dd></div>}
        </dl>
      </div>}

      {status === 'preview' && preview && <>
        {/* 아이폰 로그인 전: 앱을 먼저 추가하면 앱이 이 초대에서 열려 로그인 한 번으로 수락까지 끝난다(사파리에서 수락하고 나중에 추가하면 로그인을 두 번 한다) */}
        {iosBrowser && !signedIn ? (installGuideSeen ? <>
          <div role="status" className="mt-5 [@media(max-height:700px)]:mt-4 rounded-2xl bg-primary/5 px-4 py-3 text-[13px] leading-5 text-ink">홈 화면에 추가했다면 사파리를 닫고 <b>잇닿 근무자</b> 아이콘을 눌러 주세요. 거기서 카카오로 한 번만 로그인하면 수락까지 끝나요.</div>
          <button type="button" onClick={() => setInstallGuide(true)} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-white text-[13px] font-bold text-ink">추가 방법 다시 보기</button>
          <button type="button" onClick={() => void claimInvite()} className="flex min-h-11 w-full items-center justify-center text-[13px] font-bold text-sub">설치 없이 지금 수락하기</button>
        </> : <>
          <button type="button" onClick={() => setInstallGuide(true)} className="mt-5 [@media(max-height:700px)]:mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">앱 추가하고 수락하기 · 방법 보기</button>
          <p className="mt-2 text-center text-[11px] leading-5 text-sub">홈 화면에 추가한 잇닿 근무자에서 카카오로 한 번만 로그인하면 수락까지 끝나요{isGig ? ' · 새 근무 알림도 받아요' : ''}</p>
          <button type="button" onClick={() => void claimInvite()} className="mt-1 flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-white text-[13px] font-bold text-ink">설치 없이 지금 수락하기</button>
        </>) : <>
          <button type="button" onClick={() => void claimInvite()} className="mt-5 [@media(max-height:700px)]:mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">
            {/* 카카오톡 안에서는 로그인이 안 돼 버튼이 바깥 브라우저부터 연다(startKakaoLogin) — 라벨도 그렇게 */}
            {!signedIn ? (inKakaoTalk ? `${kakaoIos ? '사파리로' : '크롬으로'} 열고 수락하기` : '카카오로 가입하고 초대 수락') : !hasWorker ? '인적사항 등록하고 초대 수락' : '초대 수락하고 연결'}
          </button>
          <p className="mt-2 text-center text-[11px] leading-5 text-sub">{!signedIn && inKakaoTalk ? `카카오톡 안에서는 로그인이 안 돼서 ${kakaoIos ? '사파리' : '크롬'}에서 이어서 해요 · 전화번호 없이 카카오 로그인으로만 연결` : '앱 설치 없이 바로 수락돼요 · 전화번호 없이 카카오 로그인으로만 연결'}</p>
        </>}
        {isGig && signedIn && hasWorker && <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-center text-[11px] leading-5 text-sub">{bankLabel ? <>수락하면 내 지급 계좌(<b className="text-ink">{bankLabel}</b>) 정보가 이 근무지의 지급 담당자에게 전달돼요.</> : '수락 후 근태·지급 탭에서 지급 계좌를 등록·전달해 주세요.'}</p>}
        {isGig && DEMO_ENABLED && !signedIn && <Link href="/gig/demo" className="mt-2 flex min-h-11 items-center justify-center text-[12px] font-bold text-sub">내 초대가 아니라면 시연 먼저 보기 →</Link>}
      </>}
      {status === 'claiming' && <button disabled className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white opacity-60">연결 중...</button>}
      {status === 'success' && <button disabled className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white opacity-80">근무 화면으로 이동 중...</button>}
      {status === 'error' && demoBlocked && <button type="button" onClick={async () => { await leaveDemo(); window.location.replace(window.location.href); }} className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">시연 끝내고 이 초대 받기</button>}
      {status === 'error' && demoOnly && <Link href={isGig ? '/gig/demo' : '/demo'} className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">시연으로 둘러보기</Link>}
      {status === 'error' && !demoBlocked && !demoOnly && (canRetry ? <div className="mt-5 space-y-2"><button type="button" onClick={()=>setRetry(value=>value+1)} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">초대 다시 불러오기</button><Link href={routes.home} className="flex min-h-11 items-center justify-center font-bold text-primary">내 근무에서 연결 결과 확인</Link></div> : !signedIn
        // 로그인 전: '내 근무 열기'는 로그인 화면도 아닌 근무 찾기 첫 화면으로 떨어졌다 — 여기서 바로 로그인하게 한다
        ? <div className="mt-5 space-y-2"><p className="rounded-xl bg-bg p-3 text-[12px] leading-5 text-sub">이미 수락한 초대라면 로그인만 하면 {isGig ? '내 근무가' : '내 직장이'} 바로 열려요. 처음이라면 새 초대 링크를 받은 뒤 그 링크를 열어 주세요.</p><button type="button" onClick={loginToMyWork} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">{inKakaoTalk ? `${kakaoIos ? '사파리로' : '크롬으로'} 열고 로그인하기` : '이미 수락했어요 · 카카오로 로그인'}</button></div>
        : <div className="mt-5 space-y-2"><p className="rounded-xl bg-bg p-3 text-[12px] leading-5 text-sub">이미 수락한 초대라면 아래에서 내 근무를 열어 주세요. 링크가 만료됐다면 {isGig ? '사장님께' : '근무지 관리자에게'} 새 초대 링크나 QR을 요청해 주세요.</p><Link href={routes.home} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">내 근무 열기</Link></div>)}
    </section>
    {demoEnd && <DemoEndSheet kind={demoEnd} intent="leave" onClose={() => setDemoEnd(null)} />}
    {installGuide && <PwaInstallSheet onClose={() => { setInstallGuide(false); setInstallGuideSeen(true); }} note="추가한 잇닿 근무자 아이콘을 누르면 이 초대가 바로 열려요. 카카오로 한 번만 로그인하면 수락까지 끝나요." />}
  </main>;
}
