import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, SectionTitle } from '@/components/ui';
import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';

export const dynamic = 'force-dynamic';

type ChatRow = {
  applicationId: string;
  workerName: string;
  shiftDate: string;
  startTime: string;
  status: string;
  lastMessage: string | null;
  lastAt: string | null;
};

async function getChatRows(facilityId: string): Promise<ChatRow[]> {
  const sb = adminClient();
  if (!sb) return [];

  // 이 병원의 수락·완료 매칭 (최근 7일)
  const { data: apps } = await sb
    .from('shift_applications')
    .select('id, status, responded_at, workers ( name ), shifts!inner ( facility_id, shift_date, start_time )')
    .in('status', ['accepted', 'completed'])
    .eq('shifts.facility_id', facilityId)
    .order('responded_at', { ascending: false })
    .limit(30);

  if (!apps?.length) return [];

  const ids = apps.map((a) => a.id);
  const { data: lastMsgs } = await sb
    .from('chat_messages')
    .select('application_id, body, created_at')
    .in('application_id', ids)
    .order('created_at', { ascending: false });

  const lastByApp = new Map<string, { body: string; created_at: string }>();
  for (const m of lastMsgs ?? []) {
    if (!lastByApp.has(m.application_id)) lastByApp.set(m.application_id, m);
  }

  return apps.map((a) => {
    const worker = a.workers as unknown as { name: string } | null;
    const shift = a.shifts as unknown as { shift_date: string; start_time: string };
    const last = lastByApp.get(a.id);
    return {
      applicationId: a.id,
      workerName: worker?.name ?? '워커',
      shiftDate: shift.shift_date,
      startTime: shift.start_time?.slice(0, 5) ?? '',
      status: a.status,
      lastMessage: last?.body ?? null,
      lastAt: last?.created_at ?? null,
    };
  });
}

export default async function ChatsPage() {
  const facilityId = await getCurrentFacilityId();
  if (!facilityId) redirect('/setup/claim-facility');

  const rows = await getChatRows(facilityId);

  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-1 px-1">워커 채팅</h1>
      <p className="text-label text-sub mb-4 px-1">채용확정된 워커와 근무에 필요한 내용만 대화해요 · 근무 종료 24시간 후 잠김</p>

      <SectionTitle>대화 목록</SectionTitle>
      {rows.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-body font-bold text-ink">아직 채팅이 없어요</p>
          <p className="text-label text-sub mt-1">지원자를 수락하면 채팅방이 자동으로 열려요.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((row) => (
            <Link
              key={row.applicationId}
              href={`/chats/${row.applicationId}`}
              className="flex items-center justify-between px-5 py-4 active:bg-bg"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-body font-bold text-ink">{row.workerName}</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    row.status === 'accepted' ? 'bg-primary/10 text-primary' : 'bg-bg text-sub'
                  }`}>
                    {row.status === 'accepted' ? '채용확정' : '완료'}
                  </span>
                </div>
                <p className="text-label text-sub truncate mt-0.5">
                  {row.lastMessage ?? `${row.shiftDate} ${row.startTime} 근무`}
                </p>
              </div>
              <span className="text-sub text-xl flex-shrink-0 ml-3">→</span>
            </Link>
          ))}
        </Card>
      )}
    </main>
  );
}
