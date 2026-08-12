import Link from 'next/link';
import { getFacilityProfile, getFacilityAdmins } from '@/lib/actions/facility';
import { FacilityProfileForm } from './FacilityProfileForm';
import { AdminAccessSection } from './AdminAccessSection';
import { getShop } from '@/lib/db/shop';
import { ManageBackLink } from '@/components/ManageBackLink';
import { facilityTypeLabel } from '@/lib/facility-label';

export default async function SettingsPage() {
  const [profile, shop, admins] = await Promise.all([getFacilityProfile(), getShop(), getFacilityAdmins()]);
  const facilityWord = facilityTypeLabel(shop?.facilityType);

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-4 pt-1">
        <ManageBackLink href="/more" label="관리" />
        <h1 className="mt-2 px-1 text-display font-extrabold text-ink">{facilityWord} 설정</h1>
      </div>
      <section className="px-4 pt-5">
        <p className="mb-2 px-1 text-label font-bold text-sub">서비스 이용</p>
        <Link href="/membership" className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-card active:bg-bg">
          <div><p className="text-body font-bold text-ink">잇닿 요금제·결제</p><p className="mt-1 text-label text-sub">이용 중인 요금제와 서비스 청구 내역</p></div><span className="ml-4 text-sub">›</span>
        </Link>
      </section>
      {admins && admins.length > 0 && <AdminAccessSection admins={admins} facilityWord={facilityWord} />}
      <FacilityProfileForm profile={profile} facilityType={shop?.facilityType??'clinic'} />
    </div>
  );
}
