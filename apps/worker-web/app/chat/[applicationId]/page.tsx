'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { facilityName } from '@/lib/shift-display';
import { MatchChatView } from '@/components/safety/MatchChatView';
type Header = { shift_date: string; start_time: string; facilities?: { name?: string | null } | Array<{ name?: string | null }> | null };
export default function WorkerChatPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const [shift, setShift] = useState<Header | null>(null);
  useEffect(() => {
    let active = true;
    setShift(null);
    void (async () => {
      try {
        const { data } = await supabase.from('shift_applications').select('shifts(shift_date,start_time,facilities(name))').eq('id', applicationId).maybeSingle();
        const value = data?.shifts as Header | Header[] | null | undefined;
        if (active) setShift((Array.isArray(value) ? value[0] : value) ?? null);
      } catch { /* The conversation has its own visible retry state. */ }
    })();
    return () => { active = false; };
  }, [applicationId]);
  return <MatchChatView client={supabase} applicationId={applicationId} variant="worker" title={shift ? facilityName(shift) : '사업장 채팅'}
    subtitle={`${shift ? `${Number(shift.shift_date.slice(5, 7))}월 ${Number(shift.shift_date.slice(8, 10))}일 ${shift.start_time.slice(0, 5)} 근무 · ` : ''}근무 종료 24시간 후 잠겨요`} />;
}
