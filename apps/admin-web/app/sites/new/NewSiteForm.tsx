'use client';
import { useRouter } from 'next/navigation';
import { GigworkerWorkspaceStart } from '@/app/setup/claim-facility/GigworkerWorkspaceStart';

export function NewSiteForm() {
  const router = useRouter();
  return <GigworkerWorkspaceStart onBack={() => router.push('/sites')} />;
}
