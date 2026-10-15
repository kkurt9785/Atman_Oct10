'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import { formatDate } from '@/lib/format';
import { MatchChatView } from '@/components/safety/MatchChatView';
import { getChatHeader, type ChatHeader } from './actions';
export default function AdminChatPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const [header, setHeader] = useState<ChatHeader | null>(null);
  useEffect(() => {
    let active = true;
    setHeader(null);
    void getChatHeader(applicationId).then(value => { if (active) setHeader(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [applicationId]);
  return <MatchChatView client={supabase} applicationId={applicationId} variant="admin" title={header ? `${header.workerName}님과 채팅` : '근무자 채팅'}
    subtitle={`${header?.shiftDate ? `${formatDate(header.shiftDate)} ${header.startTime} 근무 · ` : ''}개인 연락처 대신 채팅을 써 주세요`} />;
}
