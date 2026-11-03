'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseShortcutRelease, shortcutPairingURL, shortcutOpenURL, type ShortcutRelease } from '../lib/shortcuts';
import { ShortcutFileInstall } from './ShortcutFileInstall';

export function ShortcutConnect({ familyId, initialized, onPrepared }: { familyId: string; initialized: boolean; onPrepared: () => Promise<void> }) {
  const [release, setRelease] = useState<ShortcutRelease | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number; code: string; normalization: 'NFC' | 'NFD'; retried?: boolean } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [normalization, setNormalization] = useState<'NFC' | 'NFD'>('NFC');
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef(0);

  useEffect(() => {
    let active = true;
    fetch('/haraguri-notifications.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => { if (active) setRelease(parseShortcutRelease(v)); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    request.current++; setLink(null); setError(''); setPreparing(false);
    setInstalled(localStorage.getItem(`haraguri-shortcut-installed-${familyId}`) === '1');
    const refresh = () => { const saved = localStorage.getItem('haraguri-shortcut-normalization'); setNormalization(saved === 'NFC' || saved === 'NFD' ? saved : 'NFD'); };
    refresh(); window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [familyId]);
  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [link]);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { if (initialized) setLink(null); }, [initialized]);

  async function prepare() {
    if (!supabase || !release) return;
    setInstalled(true); localStorage.setItem(`haraguri-shortcut-installed-${familyId}`, '1');
    const current = ++request.current;
    setPreparing(true); setError(''); setLink(null);
    try {
      const result = await supabase.rpc('hg_create_shortcut_pairing', { family: familyId });
      if (result.error) throw new Error('연결을 준비하지 못했어요. 로그인 상태를 확인하고 다시 눌러 주세요.');
      const expiresAt = Date.parse(result.data?.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('연결 버튼을 다시 눌러 주세요.');
      const mode = localStorage.getItem('haraguri-shortcut-normalization') === 'NFC' ? 'NFC' : release.name_normalization ?? 'NFC';
      const url = shortcutPairingURL(result.data.code, release.name, mode, window.location.origin);
      if (current !== request.current) return;
      setNow(Date.now()); setNormalization(mode); setLink({ url, expiresAt, code: result.data.code, normalization: mode });
      await onPrepared();
    } catch (e) {
      if (current === request.current) setError(e instanceof Error ? e.message : '연결을 준비하지 못했어요. 다시 눌러 주세요.');
    } finally {
      if (current === request.current) setPreparing(false);
    }
  }

  async function retryName() {
    if (!link || !release || !supabase || preparing || link.retried) return;
    const current = ++request.current;
    setPreparing(true); setError('');
    try {
      const status = await supabase.rpc('hg_shortcut_pairing_status', { pair_code: link.code });
      if (status.error) throw new Error('연결 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
      if (current !== request.current) return;
      if (status.data === 'claimed') { setLink(null); await onPrepared(); return; }
      if (status.data !== 'pending' || link.expiresAt <= Date.now()) throw new Error('연결 버튼이 만료됐어요. 다시 받아 주세요.');
      const key = `haraguri-pair-retried-${link.code}`;
      if (localStorage.getItem(key) === '1') throw new Error('다른 이름으로 이미 시도했어요. 단축어 이름을 확인해 주세요.');
      localStorage.setItem(key, '1');
      const mode = link.normalization === 'NFD' ? 'NFC' : 'NFD';
      const url = shortcutPairingURL(link.code, release.name, mode, window.location.origin, true);
      setLink({ ...link, url, retried: true }); setNormalization(mode);
      window.location.href = url;
    } catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : '연결하지 못했어요.'); }
    finally { if (current === request.current) setPreparing(false); }
  }

  if (!release) return <p className="muted">간편 연결 파일을 준비하고 있어요. 아래 직접 설정 방법으로도 연결할 수 있어요.</p>;
  if (initialized) return <div className="shortcut-connect"><p className="recipe-ok" role="status">계정 연결 확인 ✓ · <a href={shortcutOpenURL(release.name, normalization)}>단축어 열기</a></p><small className="muted">실제 결제 수집은 아래 수신함에서 확인해 주세요.</small></div>;
  const expired = !!link && link.expiresAt <= now;
  const collector = release.collector_ready || release.manual_trigger;
  return <div className="shortcut-connect">
    <p>{release.manual_trigger ? <><b>간편 수집 시험판</b> — 주소·전송·본문 설정이 담긴 단축어예요. 추가한 뒤 알림 자동화를 한 번 연결해 주세요.</>
      : release.collector_ready ? <>완성된 단축어를 추가하고 계정만 연결해 주세요. 주소를 붙이거나 본문 변수를 만들 필요가 없어요.</>
      : <><b>간편 연결 시험판</b> — 주소를 붙이지 않고 계정을 연결하는 기능을 먼저 시험할 수 있어요. 이 파일은 알림 자동화를 추가하지 않아요.</>}</p>
    <ol>
      {!installed && <li><b>단축어 추가</b><p className="muted">iCloud 링크를 열고 <b>단축어 추가</b>를 눌러 주세요. 이름은 <b>{release.name}</b> 그대로 두세요. iOS 27 이상이 필요해요.</p>
        <ShortcutFileInstall release={release}/>
      </li>}
      <li><b>내 계정 연결</b><p className="muted">추가한 뒤 이 화면으로 돌아와 아래 버튼을 눌러 주세요. 허용 질문이 나오면 허용해 주세요.</p>
        {link && !expired ? <a className="button-link primary" href={link.url}>내 계정 연결</a>
          : <button type="button" className="secondary" disabled={preparing} onClick={() => { void prepare(); }}>{preparing ? '준비 중…' : expired ? '연결 버튼 다시 받기' : '내 계정 연결 시작'}</button>}
        {link && !expired && <><small className="muted pairing-expiry">이 연결 버튼은 5분 동안 한 번 사용할 수 있어요.</small>
          <button type="button" className="text-button" disabled={preparing} onClick={() => { void prepare(); }}>연결 버튼 다시 받기</button>
          {!link.retried && <button type="button" className="text-button" disabled={preparing} onClick={() => { void retryName(); }}>단축어를 찾을 수 없을 때</button>}</>}
      </li>
      {collector && <li><b>{release.manual_trigger ? '알림 자동화 연결' : '앱 선택·자동화 켜기'}</b>
        {release.manual_trigger && <p className="muted">추가한 단축어를 열고 아래 검색에서 <b>앱에서 알림을 수신할 때</b>를 찾아 추가해 주세요.</p>}
        <a className="button-link" href={shortcutOpenURL(release.name, normalization)}>단축어 열기</a>
        <BankAppChoices/>
        <p className="muted">알림 카드의 파란 앱 이름 또는 ＋를 눌러 받을 앱을 고르고, 필터가 있으면 비워 주세요. 카드의 〉에서 자동화를 켜 주세요. 우리은행 알림은 <b>우리WON뱅킹</b>을 선택해 주세요.</p>
        <p className="muted">정보 ⓘ → 개인정보 보호에서 <b>잠겨 있는 동안 실행 허용</b>도 켜져 있는지 확인해 주세요.</p>
        <p className="muted">실제 새 알림이 오면 아래 수신함에서 확인할 수 있어요.</p>
      </li>}
    </ol>
    {installed && <button type="button" className="text-button" onClick={() => { setInstalled(false); localStorage.removeItem(`haraguri-shortcut-installed-${familyId}`); }}>단축어 다시 설치 안내</button>}
    {error && <p className="recipe-warn" role="alert">{error}</p>}

  </div>;
}

export function BankAppChoices() {
  const apps = [['토스', '#0064ff'], ['KB Pay', '#64533a'], ['신한', '#1659df'], ['현대', '#242424'], ['삼성', '#1843ac'], ['우리WON', '#0078b8'], ['NH', '#087846'], ['카카오페이', '#6a5300'], ['네이버페이', '#08783c']];
  return <div><p><b>쓰는 앱만 누르세요</b></p><ul aria-label="선택할 은행·결제 앱 예시" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 0, listStyle: 'none' }}>{apps.map(([name, color]) => <li key={name} style={{ textAlign: 'center', fontSize: 12 }}><svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44" style={{ display: 'block', margin: 'auto' }}><rect width="44" height="44" rx="11" fill={color}/><text x="22" y="27" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">{name === '카카오페이' ? '카카오' : name === '네이버페이' ? 'N Pay' : name}</text></svg>{name}</li>)}</ul></div>;
}
