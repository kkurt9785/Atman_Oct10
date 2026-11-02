'use client';
import { useEffect, useState } from 'react';
import { BankAppChoices } from '../../components/ShortcutConnect';
import { ShortcutFileInstall } from '../../components/ShortcutFileInstall';
import { parseShortcutRelease, type ShortcutRelease } from '../../lib/shortcuts';

export default function ShortcutInstallPage() {
  const [release, setRelease] = useState<ShortcutRelease | null>(null);
  useEffect(() => {
    fetch('/haraguri-notifications.json', { cache: 'no-store' }).then(r => r.json()).then(value => setRelease(parseShortcutRelease(value))).catch(() => {});
  }, []);
  return <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px' }}>
    <h1>하라구리 단축어 추가</h1>
    <p>주소와 본문 설정이 담긴 단축어 하나로 알림을 보내요. iOS 27 이상이 필요해요.</p>
    {release ? <ShortcutFileInstall release={release}/> : <p>단축어를 준비하고 있어요…</p>}
    <BankAppChoices/>
    <p>추가한 뒤 앱을 선택하고 자동화를 켜세요. 기존 공유본은 하라구리의 가족 설정에서 <b>내 계정 연결</b>을 눌러 주세요.</p>
    <p className="muted">처음 한 번 알림을 받을 은행 앱을 선택하고 자동화를 켜야 해요.</p>
    <a className="button-link" href="/">하라구리로 돌아가기</a>
  </main>;
}
