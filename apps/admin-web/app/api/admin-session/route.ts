import { NextRequest, NextResponse } from 'next/server';
import { bearerToken } from '@/lib/supabase';
import { clearAdminCookies, setAdminSessionCookie } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const session = await setAdminSessionCookie(token);
    return NextResponse.json({ userId: session.user.id });
  } catch (error) {
    await clearAdminCookies();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unauthorized' },
      { status: 403 },
    );
  }
}

export async function DELETE() {
  await clearAdminCookies();
  return NextResponse.json({ ok: true });
}
