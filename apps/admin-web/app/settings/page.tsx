import Link from 'next/link';
import { getFacilityProfile } from '@/lib/actions/facility';
import { FacilityProfileForm } from './FacilityProfileForm';

export default async function SettingsPage() {
  const profile = await getFacilityProfile();

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 bg-surface z-10 flex items-center px-4 py-4 border-b border-line">
        <Link href="/" className="mr-3 text-[20px] leading-none">←</Link>
        <h1 className="text-[17px] font-bold text-ink">병원 설정</h1>
      </div>
      <FacilityProfileForm profile={profile} />
    </div>
  );
}
