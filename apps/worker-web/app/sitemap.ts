import type { MetadataRoute } from 'next';
import { listPublicShifts } from '@/lib/public-jobs';

const BASE = 'https://itdot.co.kr';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const shifts = await listPublicShifts(200);
  return [
    { url: `${BASE}/intro`, changeFrequency: 'monthly', priority: 1 },
    { url: `${BASE}/jobs`, changeFrequency: 'daily', priority: 0.9 },
    ...shifts.map((s) => ({
      url: `${BASE}/jobs/${s.id}`,
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
