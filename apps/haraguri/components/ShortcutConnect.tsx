'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseShortcutRelease, shortcutPairingURL, type ShortcutRelease } from '../lib/shortcuts';
import { ShortcutFileInstall } from './ShortcutFileInstall';

export function ShortcutConnect({ familyId, initialized, onPrepared }: { familyId: string; initialized: boolean; onPrepared: () => Promise<void> }) {
  const [release, setRelease] = useState<ShortcutRelease | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef(0);

  useEffect(() => {
    let active = true;
    fetch('/haraguri-notifications.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => { if (active) setRelease(parseShortcutRelease(v)); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => { request.current++; setLink(null); setError(''); setPreparing(false); }, [familyId]);
  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [link]);
  useEffect(() => () => { request.current++; }, []);

  async function prepare() {
    if (!supabase || !release) return;
    const current = ++request.current;
    setPreparing(true); setError(''); setLink(null);
    try {
      const result = await supabase.rpc('hg_create_shortcut_pairing', { family: familyId });
      if (result.error) throw new Error('연결을 준비하지 못했어요. 로그인 상태를 확인하고 다시 눌러 주세요.');
      const expiresAt = Date.parse(result.data?.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('연결 버튼을 다시 눌러 주세요.');
      const url = shortcutPairingURL(result.data.code, release.name);
      if (current !== request.current) return;
      setNow(Date.now()); setLink({ url, expiresAt });
      await onPrepared();
    } catch (e) {
      if (current === request.current) setError(e instanceof Error ? e.message : '연결을 준비하지 못했어요. 다시 눌러 주세요.');
    } finally {
      if (current === request.current) setPreparing(false);
    }
  }

  if (!release) return <p className="muted">간편 연결 파일을 준비하고 있어요. 아래 직접 설정 방법으로도 연결할 수 있어요.</p>;
  const expired = !!link && link.expiresAt <= now;
  const collector = release.collector_ready || release.manual_trigger;
  return <div className="shortcut-connect">
    <p>{release.manual_trigger ? <><b>간편 수집 시험판</b> — 주소·전송·본문 설정이 담긴 단축어예요. 추가한 뒤 알림 자동화를 한 번 연결해 주세요.</>
      : release.collector_ready ? <>완성된 단축어를 추가하고 계정만 연결해 주세요. 주소를 붙이거나 본문 변수를 만들 필요가 없어요.</>
      : <><b>간편 연결 시험판</b> — 주소를 붙이지 않고 계정을 연결하는 기능을 먼저 시험할 수 있어요. 이 파일은 알림 자동화를 추가하지 않아요.</>}</p>
    <ol>
      <li><b>단축어 추가</b><p className="muted">아이폰에서 내려받은 파일을 열고 <b>단축어 추가</b>를 눌러 주세요. 이름은 <b>{release.name}</b> 그대로 두세요. iOS 27 이상이 필요해요.</p>
        <ShortcutFileInstall release={release} onInstall={() => { void prepare(); }}/>
      </li>
      <li><b>내 계정 연결</b><p className="muted">추가한 뒤 이 화면으로 돌아와 아래 버튼을 눌러 주세요. 허용 질문이 나오면 허용해 주세요.</p>
        {link && !expired ? <a className="button-link primary" href={link.url}>내 계정 연결</a>
          : <button type="button" className="secondary" disabled={preparing} onClick={() => { void prepare(); }}>{preparing ? '준비 중…' : expired ? '연결 버튼 다시 받기' : '단축어를 추가했어요'}</button>}
        {link && !expired && <><small className="muted pairing-expiry">이 연결 버튼은 5분 동안 한 번 사용할 수 있어요.</small>
          <button type="button" className="text-button" disabled={preparing} onClick={() => { void prepare(); }}>연결 버튼 다시 받기</button></>}
      </li>
      {collector && <li><b>{release.manual_trigger ? '알림 자동화 연결' : '앱 선택·자동화 켜기'}</b>
        {release.manual_trigger && <p className="muted">추가한 단축어를 열고 아래 검색에서 <b>앱에서 알림을 수신할 때</b>를 찾아 추가해 주세요.</p>}
        <a className="button-link" href={`shortcuts://open-shortcut?name=${encodeURIComponent(release.name)}`}>단축어 열기</a>
        <p className="muted">알림 카드의 파란 앱 이름 또는 ＋를 눌러 받을 앱을 고르고, 필터가 있으면 비워 주세요. 카드의 〉에서 자동화를 켜 주세요. 우리은행 알림은 <b>우리WON뱅킹</b>을 선택해 주세요.</p>
        <p className="muted">정보 ⓘ → 개인정보 보호에서 <b>잠겨 있는 동안 실행 허용</b>도 켜져 있는지 확인해 주세요.</p>
        <p className="muted">실제 새 알림이 오면 아래 수신함에서 확인할 수 있어요.</p>
      </li>}
    </ol>
    {error && <p className="recipe-warn" role="alert">{error}</p>}
    {initialized && <p className="recipe-ok" role="status">계정 연결 확인 ✓ · 실제 앱 알림 수신은 아래에서 확인해 주세요.</p>}
  </div>;
}
