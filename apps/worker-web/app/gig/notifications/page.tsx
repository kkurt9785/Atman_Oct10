'use client';

import { NoticeList } from '@/components/notifications/NoticeList';

// 긱워커 알림 — 긱 근무지의 출근·근태와 워크룸 알림만. 공고·지원·병원 근태 알림은 의료 워커(/notifications) 몫이다.
export default function GigNotificationsPage() {
  return <NoticeList shell="gig" eyebrow="GIG WORKER · 근무 소식" title="근무 알림" emptyHint="워크룸 공지와 출퇴근 알림이 여기에 쌓여요." />;
}
