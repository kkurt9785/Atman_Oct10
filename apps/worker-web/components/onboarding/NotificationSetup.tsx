'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { subscribeToPush, unsubscribeFromPush } from '@/lib/push-subscribe';
import { Button } from '@/components/ui/Button';

export function NotificationSetup({ onNext }: { onNext: () => void }) {
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  async function enable() {
    if (!('PushManager' in window)) {
      setNotice('iPhone은 잇닿을 홈 화면에 추가한 뒤 내 정보에서 알림을 켤 수 있어요.');
      return;
    }
    setLoading(true);
    setNotice('');
    try {
      const subscription = await subscribeToPush();
      const { data: { user } } = await supabase.auth.getUser();
      if (!subscription || !user) {
        setNotice('브라우저 알림 권한을 허용해 주세요. 지금 건너뛰어도 내 정보에서 다시 설정할 수 있어요.');
        return;
      }
      const { error } = await supabase.from('push_subscriptions').upsert({
        worker_id: user.id,
        subscription: subscription.toJSON(),
      });
      if (error) {
        await unsubscribeFromPush().catch(() => undefined);
        throw error;
      }
      onNext();
    } catch {
      setNotice('알림을 설정하지 못했어요. 내 정보에서 다시 시도할 수 있어요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col px-6 pb-10 pt-16">
      <p className="text-[13px] font-bold text-primary">마지막 단계</p>
      <h1 className="mt-2 text-[28px] font-extrabold leading-tight text-ink">내 조건에 맞는<br />시프트를 바로 받아요</h1>
      <p className="mt-3 text-[15px] leading-6 text-sub">등록한 직군과 활동 지역·반경에 맞는 새 근무, 채용 확정, 사업장 채팅을 앱 푸시로 알려드려요.</p>

      <section className="mt-8 rounded-2xl bg-white p-5 shadow-card">
        {[
          ['📍', '활동 지역 맞춤', '선택한 지역과 반경 안의 공고'],
          ['🎉', '채용 결과', '지원 수락과 출근 예정 안내'],
          ['💬', '사업장 채팅', '관리자가 보낸 근무 안내'],
        ].map(([icon, title, body]) => (
          <div key={title} className="flex gap-3 border-b border-line py-3 last:border-0">
            <span className="text-xl" aria-hidden="true">{icon}</span>
            <div><p className="text-[15px] font-bold text-ink">{title}</p><p className="mt-0.5 text-[13px] text-sub">{body}</p></div>
          </div>
        ))}
      </section>

      {notice && <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[13px] font-bold leading-5 text-amber-700">{notice}</p>}
      <div className="mt-auto space-y-2">
        <Button onClick={enable} disabled={loading}>{loading ? '알림 설정 중...' : '시프트 알림 받기'}</Button>
        <button type="button" onClick={onNext} className="h-12 w-full text-[14px] font-semibold text-sub">나중에 설정할게요</button>
      </div>
    </div>
  );
}
