import Link from 'next/link';
import { getFacilityProfile } from '@/lib/actions/facility';
import { FacilityProfileForm } from './FacilityProfileForm';
import { getShop } from '@/lib/db/shop';

export default async function SettingsPage() {
  const profile = await getFacilityProfile();
  const shop = await getShop();
  const facilityWord = shop?.facilityType === 'pharmacy' ? '약국' : '병원';

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 bg-surface z-10 flex items-center px-4 py-4 border-b border-line">
        <Link href="/" className="mr-3 text-[20px] leading-none">←</Link>
        <h1 className="text-[17px] font-bold text-ink">{facilityWord} 설정</h1>
      </div>
      <FacilityProfileForm profile={profile} facilityType={shop?.facilityType??'clinic'} />
    </div>
  );
}
