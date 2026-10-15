import { NextRequest, NextResponse } from 'next/server';
import { cleanupAccountStorage } from '@/lib/account-storage-cleanup';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { return NextResponse.json({ ok: true, ...await cleanupAccountStorage() }); }
  catch { return NextResponse.json({ error: 'Storage cleanup could not be completed' }, { status: 500 }); }
}
