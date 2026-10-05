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

const MODE_LABEL: Record<string, string> = { gps_or_qr: '앱에서 버튼만 누르기', gps: '위치(GPS) 우선', gps_qr: '위치 + 동적 QR', qr: '동적 QR만', network: '사업장 Wi-Fi만', admin: '관리자 승인만' };
type Section = 'location' | 'profile' | 'attendance' | 'brn' | 'admins';
const SECTIONS: Section[] = ['location', 'profile', 'attendance', 'brn', 'admins'];

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
  const showBrn = Boolean(shop && context && shop.approvedAt === null && shop.registrationSource.startsWith('self_'));
  const showAdmins = Boolean(admins && admins.length > 0);
  const section = SECTIONS.includes(params.section as Section) ? params.section as Section : null;
  const TITLE: Record<Section, string> = { location: '위치·연락처', profile: `${facilityWord} 소개·규모`, attendance: '출퇴근 인증 규칙', brn: '사업자 서류', admins: '관리자 권한' };

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
            ? <BrnDocumentSection facilityId={context.facilityId} brnSubmitted={shop.brnSubmitted} hasDocument={Boolean(shop.brnDocumentPath)} />
            : <p className="px-5 pt-4 text-label text-sub">제출할 사업자 서류가 없어요.</p>)}
          {section === 'admins' && (showAdmins && admins
            ? <AdminAccessSection admins={admins} facilityWord={facilityWord} />
            : <p className="px-5 pt-4 text-label text-sub">관리자 권한을 볼 수 없어요.</p>)}
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
          <Row href="/membership" title="잇닿 요금제·결제" detail="이용 중인 요금제와 서비스 청구 내역" />
        </div>
      </section>
      <section className="px-4 pt-5 pb-8">
        <p className="mb-2 px-1 text-label font-bold text-sub">{facilityWord}</p>
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-card">
          {showBrn && shop && <Row href="/settings?section=brn" title="사업자 서류" detail={shop.brnSubmitted || shop.brnDocumentPath ? '제출했어요 · 확인 중' : '제출하면 공고를 올릴 수 있어요'} warn={!shop.brnSubmitted && !shop.brnDocumentPath} />}
          <Row href="/settings?section=location" title="위치·연락처" detail={location?.addressText || '주소를 등록해 주세요'} warn={!location?.addressText} />
          <Row href="/settings?section=profile" title={`${facilityWord} 소개·규모`} detail={profile?.employee_count ? `총원 ${profile.employee_count}명` : '총원을 입력하면 부족 인원을 알려드려요'} warn={!profile?.employee_count} />
          <Row href="/settings?section=attendance" title="출퇴근 인증 규칙" detail={MODE_LABEL[profile?.attendance_mode ?? 'gps_or_qr'] ?? '앱에서 버튼만 누르기'} />
          {showAdmins && admins && <Row href="/settings?section=admins" title="관리자 권한" detail={`관리자 ${admins.length}명 · 급여 열람 권한`} />}
        </div>
      </section>
    </div>
  );
}
