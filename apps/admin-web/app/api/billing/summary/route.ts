import { NextResponse } from 'next/server';
import { getBillingSummary } from '@/lib/db/billing';
import { getUserFromBearer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getUserFromBearer(req.headers);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const summary = await getBillingSummary();
  return NextResponse.json(summary);
}
