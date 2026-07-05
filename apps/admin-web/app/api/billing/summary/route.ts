import { NextResponse } from 'next/server';
import { getBillingSummary } from '@/lib/db/billing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const summary = await getBillingSummary();
  return NextResponse.json(summary);
}
