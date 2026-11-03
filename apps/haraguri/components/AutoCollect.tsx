'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IOS_NOTIFICATION_TRIGGER_MIN, iosMajor, type Device } from '../lib/device';
import { shortcutOpenURL, shortcutPairingURL } from '../lib/shortcuts';
import { ago, shortcutImportURL, stageLabel, type AutoCollectState, type InboxRow } from '../lib/autocollect';

// 가계부 자동 수집. 한 줄 상태 → 카드 하나 → 단계마다 버튼 하나. 설정 탭의 3단계 마법사를 대신한다.
// 수집 주소·기기별 레시피·수신함 전체는 '고급' 아래로 내려 두고 평소에는 보이지 않는다.
const VIA_LABEL: Record<string, string> = { 'ios-shortcut': '아이폰 단축어', 'ios-notification': '아이폰 앱 알림', 'notification-replay': '알림 원문 복구', 'ios-shortcut-pairing': '아이폰 계정 연결', 'ios-notification-setup': '아이폰 연결 확인', 'mac-relay-sms': 'Mac 중계기 · 문자', 'mac-relay-notif': 'Mac 중계기 · 알림', 'mac-relay': 'Mac 중계기', android: '갤럭시', test: '연결 테스트', '': '문자' };
const STATUS_LABEL: Record<InboxRow['status'], string> = { saved: '가계부에 올렸어요', duplicate: '이미 있는 결제', ignored: '건너뜀', unparsed: '못 읽음' };
const DEVICE_LABEL: Record<Device, string> = { 'iphone-push': '아이폰 · 카드앱 알림', 'iphone-sms': '아이폰 · 문자', galaxy: '갤럭시' };
const appName = (app: string) => (app.includes('.') ? app.split('.').pop() ?? app : app);
type Run = (a: () => Promise<void>) => Promise<boolean>;
type Link = { code: string; url: string; expiresAt: number; normalization: 'NFC' | 'NFD'; copied: boolean; retried?: boolean };

export function AutoCollectStatus({ state, open, onToggle }: { state: AutoCollectState; open: boolean; onToggle: () => void }) {
  if (!state.loaded) return null;
  const l = stageLabel(state.stage, state.lastAt, state.saved);
  return <button type="button" className={`autocollect-line ${l.off ? 'off' : ''}`} aria-expanded={open} onClick={onToggle}><b>결제 알림 자동 수집</b><span>{l.text}</span><span className="chev" aria-hidden="true">{open ? '∧' : '›'}</span></button>;
}

export function AutoCollectSummary({ state, onOpen }: { state: AutoCollectState; onOpen: () => void }) {
  if (!state.loaded) return <p className="muted">수집 상태를 확인하고 있어요…</p>;
  const l = stageLabel(state.stage, state.lastAt, state.saved);
  return <p className="muted">{l.text} · <button type="button" className="text-button inline" onClick={onOpen}>가계부에서 {l.off ? '켜기' : '보기'} →</button></p>;
}

export function AutoCollectBanner({ state, onOpen }: { state: AutoCollectState; onOpen: () => void }) {
  const key = `haraguri-collect-nudge-${state.familyId}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(key) === '1'); } catch { setHidden(false); } }, [key]);
  if (hidden || !state.loaded || !['install', 'enable', 'pair'].includes(state.stage)) return null;
  return <div role="status" className="banner autocollect-banner">💳 결제 알림 자동 수집을 켜 볼까요? 2분이면 돼요.<span className="banner-actions"><button onClick={onOpen}>켜기 →</button><button className="text-button" onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } setHidden(true); }}>나중에</button></span></div>;
}

export function AutoCollectCard({ state, busy, run, onClose }: { state: AutoCollectState; busy: boolean; run: Run; onClose: () => void }) {
  const { familyId, userId, stage, release, device, setDevice, ios, token, current, inbox, proof, lastAt, saved, setFlag, refresh } = state;
  const [link, setLink] = useState<Link | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [now, setNow] = useState(Date.now());
  const req = useRef(0);
  const url = token ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ingest?token=${token.token}` : '';

  useEffect(() => () => { req.current++; }, []);
  useEffect(() => { if (state.paired) setLink(null); }, [state.paired]);
  // While a pairing code is out: tick the countdown and ask the server whether the shortcut has claimed it.
  useEffect(() => {
    if (!link || !supabase) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const r = await supabase!.rpc('hg_shortcut_pairing_status', { pair_code: link.code });
      if (r.data === 'claimed') { setFlag('paired', true); setLink(null); void refresh(); }
    }, 3000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [link, setFlag, refresh]);

  // Clipboard calls can hang (e.g. after an app-switch attempt); never wait on them longer than 2.5 s.
  const bounded = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 2500))]);
  async function copy(text: string, key: string) {
    try { await bounded(navigator.clipboard.writeText(text)); setCopied(key); setTimeout(() => setCopied(null), 1500); return true; } catch { return false; }
  }

  // One tap: make a code, put it on the clipboard, open the shortcut with the code as input.
  // The clipboard copy covers the case where shortcuts:// can't find the shortcut by name — the user then runs it by hand
  // and the shortcut reads the code from the clipboard ('입력이 없는 경우' = 클립보드 가져오기).
  async function connect(retry = false) {
    if (!supabase || !release) return;
    const n = ++req.current;
    setWorking(true); setError('');
    const mode: 'NFC' | 'NFD' = retry && link ? (link.normalization === 'NFD' ? 'NFC' : 'NFD') : release.name_normalization ?? 'NFC';
    const codeP: Promise<{ code: string; expiresAt: number }> = retry && link ? Promise.resolve({ code: link.code, expiresAt: link.expiresAt })
      : (async () => {
        const r = await supabase!.rpc('hg_create_shortcut_pairing', { family: familyId });
        if (r.error) throw new Error('연결을 준비하지 못했어요. 로그인 상태를 확인하고 다시 눌러 주세요.');
        const expiresAt = Date.parse(r.data?.expires_at);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('연결하기를 다시 눌러 주세요.');
        return { code: String(r.data.code), expiresAt };
      })();
    // Hand the clipboard a promise so the write stays inside the tap gesture (iOS Safari drops it after an await).
    // Never let a stuck clipboard block the connection: after 2.5 s we move on and offer the manual copy button instead.
    let copiedCode = false;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await bounded(navigator.clipboard.write([new ClipboardItem({ 'text/plain': codeP.then(r => new Blob([r.code], { type: 'text/plain' })) })]));
        copiedCode = true;
      }
    } catch { /* fall back to writeText below */ }
    try {
      const r = await codeP;
      if (n !== req.current) return;
      if (!copiedCode) copiedCode = await copy(r.code, 'code');
      const u = shortcutPairingURL(r.code, release.name, mode, window.location.origin, retry);
      setNow(Date.now()); setLink({ ...r, url: u, normalization: mode, copied: copiedCode, retried: retry || undefined });
      window.location.href = u;
    } catch (e) { if (n === req.current) setError(e instanceof Error ? e.message : '연결하지 못했어요. 다시 눌러 주세요.'); }
    finally { if (n === req.current) setWorking(false); }
  }

  async function sendTest() {
    if (!url) return;
    setTesting(true);
    try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '하라구리 연결 테스트', via: 'test' }) }); setTimeout(() => { void refresh(); }, 1200); }
    catch { /* shown by the inbox staying empty */ } finally { setTesting(false); }
  }
  async function remove(row: InboxRow) { await supabase!.from('hg_inbox').delete().eq('id', row.id); void refresh(); }
  const createToken = () => run(async () => { const i = await supabase!.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }); if (i.error) throw i.error; await refresh(); });
  const rotateToken = () => { if (!window.confirm('새 주소를 만들면 폰에 넣어 둔 이전 주소는 더 이상 동작하지 않아요. 아이폰 단축어는 계정을 다시 연결해야 해요. 계속할까요?')) return; void run(async () => { const d = await supabase!.from('hg_ingest_tokens').delete().eq('family_id', familyId).eq('user_id', userId); if (d.error) throw d.error; const i = await supabase!.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }); if (i.error) throw i.error; setFlag('paired', false); await refresh(); }); };
  const disable = () => { if (!window.confirm('자동 수집을 끌까요? 폰의 자동화는 더 이상 저장되지 않아요.')) return; void run(async () => { const d = await supabase!.from('hg_ingest_tokens').delete().eq('family_id', familyId).eq('user_id', userId); if (d.error) throw d.error; setFlag('paired', false); await refresh(); }); };

  if (!state.loaded) return <section className="autocollect-card"><p className="muted">수집 상태를 확인하고 있어요…</p></section>;
  const expired = !!link && link.expiresAt <= now;
  const major = iosMajor(ios);
  // Once payments flow, ignored alerts (rewards, events) only bury them; while waiting, the setup ping row is the reassurance.
  const recent = (stage === 'collecting' ? current.filter(r => r.status !== 'ignored') : current).slice(0, 3);
  const unparsed = inbox.filter(r => r.status === 'unparsed');
  const visibleInbox = showIgnored ? inbox : inbox.filter(r => r.status !== 'ignored');
  const ignoredCount = inbox.length - inbox.filter(r => r.status !== 'ignored').length;
  const desktop = typeof navigator !== 'undefined' && !/iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  const stepNo = ({ install: 1, pair: 2 } as Partial<Record<typeof stage, number>>)[stage];
  const pairedHours = state.pairedAt ? (Date.now() - Date.parse(state.pairedAt)) / 3_600_000 : 0;
  const name = release?.name ?? '하라구리 알림 수집';
  const list = (rows: InboxRow[]) => <ul className="inbox-list">{rows.map(r => <li key={r.id} className={`inbox-row ${r.status}`}>
    <span className={`inbox-status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
    <span className="inbox-meta">{ago(r.received_at)} · {VIA_LABEL[r.via] ?? r.via}{r.app ? ` · ${appName(r.app)}` : ''}</span>
    <small className={r.status === 'unparsed' ? 'raw-text' : ''}>{r.status === 'unparsed' ? r.raw : r.summary}</small>
    {r.status === 'unparsed' && <span className="inbox-actions"><button type="button" className="text-button" onClick={() => { void copy(r.raw, r.id); }}>{copied === r.id ? '복사했어요 ✓' : '원문 복사'}</button><button type="button" className="text-button" onClick={() => { void remove(r); }}>지우기</button></span>}
  </li>)}</ul>;

  return <section className="autocollect-card" aria-label="결제 알림 자동 수집">
    {stepNo && <p className="stage-step">{stepNo} / 2 단계{desktop && ' · 아이폰의 하라구리에서 이 화면을 열면 2분이면 돼요'}</p>}

    {stage === 'install' && <>
      <h3>단축어 추가</h3>
      <p className="muted">단축어 앱이 바로 열려요. <b>단축어 추가</b>를 누른 뒤, 그 단축어 맨 위 알림 카드의 <b>〉</b>에서 <b>자동화를 켜</b> 주세요. 받을 앱 목록은 미리 들어 있어요(안 쓰는 앱은 빼도 돼요). iOS {IOS_NOTIFICATION_TRIGGER_MIN} 이상.</p>
      {ios && major !== null && major < IOS_NOTIFICATION_TRIGGER_MIN && <p className="recipe-warn">이 아이폰은 iOS {ios}예요. 카드앱 알림 자동화는 iOS {IOS_NOTIFICATION_TRIGGER_MIN}부터 돼요. 아래 고급에서 <b>아이폰 · 문자</b> 방법을 쓸 수 있어요.</p>}
      <div className="actions">{release?.icloud_url ? <><a className="button-link" href={shortcutImportURL(release.icloud_url)} onClick={() => setFlag('installed', true)}>단축어 추가</a><a className="text-button" href={release.icloud_url} onClick={() => setFlag('installed', true)}>iCloud에서 열기</a></> : <span className="muted">단축어 파일을 준비하고 있어요…</span>}
        <button type="button" className="text-button" onClick={() => setFlag('installed', true)}>이미 추가했어요</button></div>
    </>}

    {stage === 'pair' && <>
      <h3>내 계정 연결</h3>
      <p className="muted">단축어를 추가하고 자동화를 켰다면 누르세요. 연결 코드를 복사하고 단축어를 실행해요 — 허용 질문엔 <b>항상 허용</b>. 잠시 뒤 여기에 <b>연결됨 ✓</b>이 떠요.</p>
      <details className="recipe"><summary>앱 고르기 · 자동화 켜는 법</summary>
        <BankAppChoices/>
        <p className="muted">단축어 앱 → <b>{name}</b> → 맨 위 알림 카드의 파란 앱 이름(또는 ＋)으로 앱을 고르고, 카드의 〉에서 <b>자동화 켬</b>. 우리은행 알림은 <b>우리WON뱅킹</b>이에요. 정보 ⓘ → 개인정보 보호 → <b>잠겨 있는 동안 실행 허용</b>도 켜 두면 화면이 꺼져 있어도 모여요.</p>
        <a className="button-link secondary-link" href={shortcutOpenURL(release?.name, release?.name_normalization)}>단축어 앱에서 열기</a>
      </details>
      <div className="actions">
        {link && !expired ? <a className="button-link" href={link.url}>단축어 열기</a> : <button type="button" className="primary" disabled={working || !release} onClick={() => { void connect(); }}>{working ? '준비 중…' : '연결하기'}</button>}
        {link && !expired && <button type="button" className="text-button" disabled={working} onClick={() => { void connect(); }}>새 코드로 다시</button>}
      </div>
      {link && !expired && <details className="recipe" open={!link.copied}><summary>단축어가 안 열리거나 ‘찾을 수 없다’고 하면</summary>
        <ol>
          <li>{link.copied ? '연결 코드는 이미 복사돼 있어요.' : <>연결 코드를 복사하세요: <button type="button" className="text-button inline" onClick={() => { void copy(link.code, 'code'); }}>{copied === 'code' ? '복사했어요 ✓' : '복사'}</button></>}<code className="pair-code">{link.code}</code></li>
          <li><a href="shortcuts://">단축어 앱 열기</a> → 목록에서 <b>{name}</b>의 ▶ 실행 → 허용. (처음 한 번은 편집 → 첫 카드의 <b>계속하기</b>를 <b>클립보드 가져오기</b>로 바꿔 두세요.)</li>
          {!link.retried && <li>이름이 달라 안 열리면 <button type="button" className="text-button inline" disabled={working} onClick={() => { void connect(true); }}>다른 이름으로 다시 열기</button></li>}
        </ol>
        <small className="muted pairing-expiry">코드는 5분 동안 한 번 쓸 수 있어요 · 남은 시간 {Math.max(0, Math.ceil((link.expiresAt - now) / 1000))}초</small>
      </details>}
      {expired && <p className="muted">연결 코드가 만료됐어요. <b>연결하기</b>를 다시 눌러 주세요.</p>}
    </>}

    {stage === 'waiting' && <>
      <h3>연결됨 ✓ · 첫 결제 알림 기다리는 중</h3>
      <p className="muted">카드앱 알림이 오면 가계부 피드와 가족 채팅에 바로 올라와요. 바로 확인하려면 카드앱에서 알림을 하나 받아 보세요.</p>
      {pairedHours >= 6 && <p className="recipe-warn">연결한 지 {Math.floor(pairedHours)}시간이 지났는데 아직 알림이 안 왔어요. 단축어 맨 위 알림 카드의 <b>자동화</b>가 켜져 있는지 확인해 주세요. <a href={shortcutOpenURL(release?.name, release?.name_normalization)}>단축어 앱에서 열기</a></p>}
      {recent.length > 0 && list(recent)}
    </>}

    {stage === 'collecting' && <>
      <h3>수집 중 ✓</h3>
      <p className="muted">마지막 {lastAt ? ago(lastAt) : '-'}{proof?.app ? ` · ${appName(proof.app)}` : ''} · 지금까지 {saved.toLocaleString('ko-KR')}건 저장{unparsed.length > 0 && <> · <b className="usage-warn">못 읽음 {unparsed.length}건</b></>}</p>
      {recent.length > 0 && list(recent)}
    </>}

    {stage === 'other' && <>
      <h3>{DEVICE_LABEL[device]}로 받기</h3>
      {!token ? <div className="actions"><button type="button" className="primary" disabled={busy} onClick={() => { void createToken(); }}>자동 수집 주소 만들기</button><small className="muted">주소를 만든 뒤 아래 방법대로 폰에 넣어 주세요.</small></div> : <>
        {device === 'iphone-sms' && <ol className="recipe">
          <li><b>단축어 받기</b> — 두 버튼을 차례로 누르면 단축어 앱이 열리고 “내 수집 주소” 질문이 떠요. 그 칸에 <b>붙여넣기</b> → <b>단축어 추가</b>.
            <div className="actions"><button type="button" className="secondary" onClick={() => { void copy(url, 'url'); }}>{copied === 'url' ? '복사했어요 ✓' : '① 주소 복사'}</button><a className="button-link" href="/haraguri-collect.shortcut" target="_blank" rel="noopener" download="하라구리 수집.shortcut">② 단축어 받기</a></div></li>
          <li><b>자동화 연결</b> — 단축어 앱 → 자동화 → ＋ → <b>메시지</b> → “메시지에 다음 포함”에 <code>승인</code> (또는 <code>원</code>) → <b>즉시 실행</b> → 다음 → <b>하라구리 수집</b> 선택.</li>
          <li>다음 승인 문자가 오면 여기 <b>수집 중 ✓</b>이 떠요.</li>
        </ol>}
        {device === 'galaxy' && <ol className="recipe">
          <li>Play 스토어에서 <b>MacroDroid</b> 설치 → 매크로 추가</li>
          <li>트리거 <b>알림 수신</b> → 카드앱·카카오톡 선택. 문자도 받으려면 트리거 <b>SMS 수신</b>(내용에 “승인”/“출금”)을 하나 더 추가</li>
          <li>동작 <b>HTTP 요청</b> → POST → URL에 수집 주소 <button type="button" className="text-button inline-copy" onClick={() => { void copy(url, 'url'); }}>{copied === 'url' ? '복사했어요 ✓' : '주소 복사'}</button> → 콘텐츠 유형 JSON → 본문 <code>{'{"title":"[not_title]","body":"[not_text]","app":"[not_app_name]","via":"android"}'}</code> <button type="button" className="text-button inline-copy" onClick={() => { void copy('{"title":"[not_title]","body":"[not_text]","app":"[not_app_name]","via":"android"}', 'gx'); }}>{copied === 'gx' ? '복사했어요 ✓' : '본문 복사'}</button></li>
          <li>문자 트리거의 본문은 <code>{'{"text":"[sms_message]","via":"android"}'}</code></li>
        </ol>}
        {device === 'iphone-push' && <p className="muted">아이폰 카드앱 알림 방법은 위 단계를 따라 주세요.</p>}
        {recent.length > 0 && list(recent)}
      </>}
    </>}

    <details className="recipe advanced"><summary>고급 · 수집 주소 · 다른 기기 · 수신함</summary>
      <div className="chips" role="group" aria-label="기기 선택">{(Object.keys(DEVICE_LABEL) as Device[]).map(d => <button type="button" key={d} className={`chip ${device === d ? 'on' : ''}`} aria-pressed={device === d} onClick={() => setDevice(d)}>{DEVICE_LABEL[d]}</button>)}</div>
      {token ? <>
        <label>내 수집 주소<input readOnly value={url} onFocus={e => e.target.select()} aria-label="수집 주소"/></label>
        <div className="actions"><button type="button" className="secondary" onClick={() => { void copy(url, 'url'); }}>{copied === 'url' ? '복사했어요 ✓' : '주소 복사'}</button>
          <button type="button" className="secondary" disabled={testing} onClick={() => { void sendTest(); }}>{testing ? '보내는 중…' : '연결 테스트 보내기'}</button>
          <button type="button" className="text-button" disabled={busy} onClick={rotateToken}>주소 새로 만들기</button>
          <button type="button" className="text-button danger" disabled={busy} onClick={disable}>끄기</button></div>
        <small className="muted">주소에 든 토큰은 비밀번호처럼 다뤄 주세요. 지금까지 {saved.toLocaleString('ko-KR')}건 저장{token.last_used_at ? ` · 마지막 수신 ${ago(token.last_used_at)}` : ''}</small>
      </> : <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => { void createToken(); }}>자동 수집 주소 만들기</button><small className="muted">아이폰 단축어는 계정 연결 때 주소가 자동으로 만들어져요. 직접 설정할 때만 눌러 주세요.</small></div>}
      <div className="actions"><button type="button" className="text-button" onClick={() => { setFlag('installed', false); setFlag('enabled', false); }}>설치 안내 다시 보기</button></div>
      {inbox.length > 0 && <><p className="muted">최근 수신 {Math.min(visibleInbox.length, 8)}건{ignoredCount > 0 && <> · <button type="button" className="text-button inline" onClick={() => setShowIgnored(s => !s)}>{showIgnored ? '무시된 알림 숨기기' : `무시 ${ignoredCount}건 보기`}</button></>}</p>{visibleInbox.length > 0 && list(visibleInbox.slice(0, 8))}</>}
      {unparsed.length > 0 && <p className="muted">못 읽은 알림은 원문 그대로 남겨 두니, 가계부에 직접 적거나 원문을 복사해 알려 주시면 읽는 법을 더해요.</p>}
    </details>
    {error && <p className="recipe-warn" role="alert">{error}</p>}
    <div className="actions"><button type="button" className="text-button" onClick={onClose}>닫기</button></div>
  </section>;
}

export function BankAppChoices() {
  const apps = [['토스', '#0064ff'], ['KB Pay', '#64533a'], ['신한', '#1659df'], ['현대', '#242424'], ['삼성', '#1843ac'], ['우리WON', '#0078b8'], ['NH', '#087846'], ['카카오페이', '#6a5300'], ['네이버페이', '#08783c']];
  return <div><p><b>쓰는 앱만 누르세요</b></p><ul aria-label="선택할 은행·결제 앱 예시" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 0, listStyle: 'none' }}>{apps.map(([name, color]) => <li key={name} style={{ textAlign: 'center', fontSize: 12 }}><svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44" style={{ display: 'block', margin: 'auto' }}><rect width="44" height="44" rx="11" fill={color}/><text x="22" y="27" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">{name === '카카오페이' ? '카카오' : name === '네이버페이' ? 'N Pay' : name}</text></svg>{name}</li>)}</ul></div>;
}
