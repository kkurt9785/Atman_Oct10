
import { NextResponse } from 'next/server';
import { getBillingSummary } from '@/lib/db/billing';
import { getAdminContext } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const summary = await getBillingSummary();
  return NextResponse.json(summary, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
