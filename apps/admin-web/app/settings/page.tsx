import Link from 'next/link';
import { getFacilityProfile, getFacilityAdmins, getFacilityLocation } from '@/lib/actions/facility';
import { getAdminContext } from '@/lib/admin-auth';
import { FacilityLocationSection } from './FacilityLocationSection';
import { BrnDocumentSection } from './BrnDocumentSection';
import { FacilityProfileForm } from './FacilityProfileForm';
import { AdminAccessSection } from './AdminAccessSection';
import { getShop } from '@/lib/db/shop';
import { ManageBackLink } from '@/components/ManageBackLink';
import { facilityTypeLabel } from '@/lib/facility-label';
import { AccountClosureSection } from './AccountClosureSection';
import { adminClient } from '@/lib/supabase';
import { isGigworkerFacility } from '@/lib/facility-mode';

const MODE_LABEL: Record<string, string> = { gps_or_qr: '간편 인증', gps: '기존 GPS 우선', gps_qr: '강화 인증 · 위치 + QR', qr: '고급 · 동적 QR만', network: '고급 · 등록 네트워크만', admin: '관리자 처리' };
type Section = 'location' | 'profile' | 'attendance' | 'brn' | 'admins' | 'account';
const SECTIONS: Section[] = ['location', 'profile', 'attendance', 'brn', 'admins', 'account'];
// 국세청 조회로 공고가 막히는 상태(lib/posting-gate.ts 와 같은 값)
const NTS_BLOCKED_DETAIL: Record<string, string> = { closed: '국세청 조회: 폐업 사업자 — 확인이 필요해요', suspended: '국세청 조회: 휴업 사업자 — 확인이 필요해요', unknown: '국세청에서 등록번호를 확인하지 못했어요 — 확인이 필요해요' };

// 설정은 토스 '전체' 탭처럼 목록만 — 누르면 그 설정 하나만 있는 화면(?section=)이 열린다
function Row({ href, title, detail, warn }: { href: string; title: string; detail: string; warn?: boolean }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 px-5 py-4 active:bg-bg">
      <div className="min-w-0"><p className="text-body font-bold text-ink">{title}</p><p className={`mt-0.5 truncate text-label ${warn ? 'font-bold text-warn' : 'text-sub'}`}>{detail}</p></div>
      <span aria-hidden className="ml-2 shrink-0 text-sub">›</span>
    </Link>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const [profile, shop, admins, location, context, params] = await Promise.all([getFacilityProfile(), getShop(), getFacilityAdmins(), getFacilityLocation(), getAdminContext(), searchParams]);
  const canEditLocation = ['owner', 'operator', 'super'].includes(context?.accessRole ?? '');
  const facilityWord = facilityTypeLabel(shop?.facilityType);
  // 승인 뒤에 국세청 상태가 휴업·폐업·미확인으로 바뀐 사업장도 공고가 막힌다 — 공고 화면이 안내하는 '설정 › 사업자 서류'가 열려 있어야 한다
  const ntsBlocked = Boolean(shop?.businessStatus && NTS_BLOCKED_DETAIL[shop.businessStatus]);
  const showBrn = Boolean(shop && context && ((shop.approvedAt === null && shop.registrationSource.startsWith('self_')) || ntsBlocked));
  // 서류 제출 RPC(submit_facility_brn_document)는 승인 전 사업장만 받는다 — 승인된 사업장은 운영팀이 확인한다
  const canResubmitBrn = shop?.approvedAt === null;
  const showAdmins = Boolean(admins && admins.length > 0);
  const section = SECTIONS.includes(params.section as Section) ? params.section as Section : null;
  // 계정 탈퇴는 운영 중인(내가 소유한) 사업장이 없을 때만 — 설정 화면에서 미리 알려 준다
  const sbAdmin = adminClient();
  const { data: ownedActive } = context && sbAdmin
    ? await sbAdmin.from('facilities').select('id').eq('admin_user_id', context.user.id).is('deleted_at', null).eq('is_active', true).limit(1)
    : { data: [] as Array<{ id: string }> };
  const ownsActive = (ownedActive ?? []).length > 0;
  const canClose = ['owner', 'super'].includes(context?.accessRole ?? '');
  const TITLE: Record<Section, string> = { location: '위치·연락처', profile: `${facilityWord} 소개·규모`, attendance: '출퇴근 인증 규칙', brn: '사업자 서류', admins: '관리자 권한', account: '계정·사업장 종료' };

  if (section) {
    return (
      <div className="min-h-screen bg-surface">
        <div className="px-4 pt-1">
          <ManageBackLink href="/settings" label={`${facilityWord} 설정`} />
          <h1 className="mt-2 px-1 text-display font-extrabold text-ink">{TITLE[section]}</h1>
        </div>
        <div className="pt-2">
          {section === 'location' && (location
            ? <FacilityLocationSection initial={location} facilityWord={facilityWord} gpsRadiusMeters={profile?.gps_radius_meters ?? 30} canEdit={canEditLocation} />
            : <p className="px-5 pt-4 text-label text-sub">위치 정보를 불러오지 못했어요.</p>)}
          {(section === 'profile' || section === 'attendance') && <FacilityProfileForm profile={profile} facilityType={shop?.facilityType ?? 'clinic'} part={section} />}
          {section === 'brn' && (showBrn && shop && context
            ? (canResubmitBrn
              ? <BrnDocumentSection facilityId={context.facilityId} brnSubmitted={shop.brnSubmitted} hasDocument={Boolean(shop.brnDocumentPath)} businessStatus={shop.businessStatus} businessStatusDetail={shop.businessStatusDetail} />
              : <section className="mx-4 mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <p className="text-[0.875rem] font-bold text-amber-800">{NTS_BLOCKED_DETAIL[shop.businessStatus ?? ''] ?? '사업자 상태 확인이 필요해요'}{shop.businessStatusDetail ? ` (${shop.businessStatusDetail})` : ''}</p>
                  <p className="mt-2 text-[0.8125rem] leading-5 text-amber-700">이미 승인된 사업장은 여기서 서류를 바꿀 수 없어요. 고객센터(운영팀)로 연락해 주시면 사업자 상태를 다시 확인하고 공고 등록을 열어 드려요.</p>
                  <a href="tel:01090455699" className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-amber-600 text-[0.875rem] font-bold text-white">고객센터 전화 문의 · 010-9045-5699</a>
                </section>)
            : <p className="px-5 pt-4 text-label text-sub">제출할 사업자 서류가 없어요.</p>)}
          {section === 'admins' && (showAdmins && admins
            ? <AdminAccessSection admins={admins} facilityWord={facilityWord} canInvite={context?.accessRole === 'owner' && !shop?.isDemo} />
            : <p className="px-5 pt-4 text-label text-sub">관리자 권한을 볼 수 없어요.</p>)}
          {section === 'account' && <AccountClosureSection facilityName={shop?.name ?? ''} facilityWord={facilityWord} canClose={canClose} ownsActive={ownsActive} isDemo={Boolean(shop?.isDemo)} />}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-4 pt-1">
        <ManageBackLink href="/more" label="관리" />
        <h1 className="mt-2 px-1 text-display font-extrabold text-ink">{facilityWord} 설정</h1>
      </div>
      <section className="px-4 pt-5">
        <p className="mb-2 px-1 text-label font-bold text-sub">서비스 이용</p>
        <div className="overflow-hidden rounded-2xl bg-white shadow-card">
          <Row href="/sites" title="사업장·현장 관리" detail={isGigworkerFacility(shop) ? '여러 행사장·작업장 추가 및 전환' : '다른 사업장·단기 근무 현장 추가 및 전환'} />
          <Row href="/membership" title="잇닿 요금제·결제" detail="이용 중인 요금제와 서비스 청구 내역" />
        </div>
      </section>
      <section className="px-4 pt-5 pb-8">
        <p className="mb-2 px-1 text-label font-bold text-sub">{facilityWord}</p>
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-card">
          {showBrn && shop && <Row href="/settings?section=brn" title="사업자 서류" detail={ntsBlocked ? NTS_BLOCKED_DETAIL[shop.businessStatus ?? ''] : shop.brnSubmitted || shop.brnDocumentPath ? '제출했어요 · 확인 중' : '제출하면 공고를 올릴 수 있어요'} warn={ntsBlocked || (!shop.brnSubmitted && !shop.brnDocumentPath)} />}
          <Row href="/settings?section=location" title="위치·연락처" detail={location?.addressText || '주소를 등록해 주세요'} warn={!location?.addressText} />
          <Row href="/settings?section=profile" title={`${facilityWord} 소개·규모`} detail={profile?.employee_count ? `총원 ${profile.employee_count}명` : '총원을 입력하면 부족 인원을 알려드려요'} warn={!profile?.employee_count} />
          <Row href="/settings?section=attendance" title="출퇴근 인증 규칙" detail={MODE_LABEL[profile?.attendance_mode ?? 'gps_or_qr'] ?? '앱에서 버튼만 누르기'} />
          {showAdmins && admins && <Row href="/settings?section=admins" title="관리자 권한" detail={`관리자 ${admins.length}명 · 급여 열람 권한`} />}
        </div>
      </section>
      <section className="px-4 pb-10">
        <p className="mb-2 px-1 text-label font-bold text-sub">계정</p>
        <div className="overflow-hidden rounded-2xl bg-white shadow-card">
          <Row href="/settings?section=account" title="계정·사업장 종료" detail={`${facilityWord} 닫기 · 관리자 계정 탈퇴`} />
          <Row href="/safety" title="대화 안전·차단 관리" detail="차단한 사용자 확인·차단 해제" />
          <Row href="/privacy" title="개인정보 처리방침" detail="수집 항목·보관 기간·삭제 요청" />
        </div>
      </section>
    </div>
  );
}
