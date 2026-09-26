'use client';

import { NoticeList } from '@/components/notifications/NoticeList';

// 의료 워커 알림 — 공고·지원·채팅·급여와 병원·약국 근태·워크룸. 긱 근무지 알림은 /gig/notifications 에서만 보인다.
export default function NotificationsPage() {
  return <NoticeList shell="medical" eyebrow="놓친 알림도 한곳에서" title="알림" emptyHint="새 근무·채팅·출퇴근 알림이 여기에 쌓여요." />;
}
