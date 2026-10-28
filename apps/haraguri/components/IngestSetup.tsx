'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { detectDevice, iosMajor, IOS_NOTIFICATION_TRIGGER_MIN, type Device } from '../lib/device';

// Per-member collect address, phone setup wizard and live inbox. The token is shown once per load; rotating it invalidates the old one.
// Every delivery to the address lands in hg_inbox with its outcome, so "did my phone send it?" is answered here, live, without a round trip to the ledger.
type Token = { token: string; received: number; last_used_at: string | null };
type InboxRow = { id: string; received_at: string; via: string; app: string; raw: string; status: 'saved' | 'duplicate' | 'ignored' | 'unparsed'; summary: string };

const CARD_APPS = ['KB Pay', '신한 SOL페이', '삼성카드', '현대카드', '롯데카드', '우리WON카드', '하나Pay', 'NH카드', '토스', '카카오페이', '네이버페이', '카카오뱅크', '토스뱅크'];
const VIA_LABEL: Record<string, string> = { 'ios-shortcut': '아이폰 단축어', 'mac-relay-sms': 'Mac 중계기 · 문자', 'mac-relay-notif': 'Mac 중계기 · 알림', 'mac-relay': 'Mac 중계기', android: '갤럭시', test: '연결 테스트', '': '문자' };
const STATUS_LABEL: Record<InboxRow['status'], string> = { saved: '가계부에 올렸어요', duplicate: '이미 있는 결제', ignored: '건너뜀', unparsed: '못 읽음' };
const DEVICE_LABEL: Record<Device, string> = { 'iphone-push': '아이폰 · 카드앱 알림', 'iphone-sms': '아이폰 · 문자', galaxy: '갤럭시' };
// Which inbox labels prove that the recipe for a device is working (test pings never count).
const PROOF: Record<Device, string[]> = { 'iphone-push': ['ios-shortcut'], 'iphone-sms': ['', 'ios-shortcut'], galaxy: ['android'] };

const appName = (app: string) => (app.includes('.') ? app.split('.').pop() ?? app : app);
function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function IngestSetup({ familyId, userId, busy, run }: { familyId: string; userId: string; busy: boolean; run: (a: () => Promise<void>) => Promise<boolean> }) {
  const [token, setToken] = useState<Token | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [device, setDevice] = useState<Device>('iphone-push');
  const [ios, setIos] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [, setTick] = useState(0);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;

  async function load() {
    if (!supabase) return;
    const [t, i] = await Promise.all([
      supabase.from('hg_ingest_tokens').select('token,received,last_used_at').eq('family_id', familyId).eq('user_id', userId).maybeSingle(),
      supabase.from('hg_inbox').select('id,received_at,via,app,raw,status,summary').eq('user_id', userId).order('received_at', { ascending: false }).limit(30),
    ]);
    setToken(t.data ?? null); setInbox((i.data ?? []) as InboxRow[]); setLoaded(true);
  }
  useEffect(() => { load(); const d = detectDevice(navigator.userAgent); setDevice(d.device); setIos(d.ios); }, [familyId, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel(`inbox-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'hg_inbox', filter: `user_id=eq.${userId}` }, () => load()).subscribe();
    const timer = setInterval(() => setTick(x => x + 1), 30_000); // keeps "방금 / N분 전" honest
    return () => { supabase!.removeChannel(channel); clearInterval(timer); };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const url = token ? `${base}/functions/v1/ingest?token=${token.token}` : '';
  async function copy(text: string, key: string) { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ } }
  async function sendTest() {
    if (!url) return;
    setTesting(true);
    try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '하라구리 연결 테스트', via: 'test' }) }); setTimeout(load, 1200); }
    catch { /* shown by the inbox staying empty */ } finally { setTesting(false); }
  }
  async function remove(row: InboxRow) { await supabase!.from('hg_inbox').delete().eq('id', row.id); setInbox(v => v.filter(r => r.id !== row.id)); }

  const latest = inbox[0];
  const unparsed = inbox.filter(r => r.status === 'unparsed');
  const proof = inbox.find(r => PROOF[device].includes(r.via) && r.via !== 'test' && r.status !== 'ignored');
  const connected = !!proof;
  const major = iosMajor(ios);
  const appList = apps.length ? apps.join(', ') : '카드앱';
  const galaxyBody = '{"title":"[not_title]","body":"[not_text]","app":"[not_app_name]","via":"android"}';

  if (!loaded) return <p className="muted">수집 주소를 확인하고 있어요…</p>;
  return <div className="ingest-setup">
    <p className="muted">결제 문자나 카드앱 알림이 폰에 오면, 폰이 알아서 이 주소로 보내고 가계부에 <b>확인 대기</b>로 올라와요. 카드사 로그인 정보는 어디에도 저장하지 않아요.</p>

    <section className="wizard-step" aria-label="1단계 수집 주소">
      <h4><span className="step-no">1</span>내 수집 주소{token && <span className="step-done">✓</span>}</h4>
      {token ? <>
        <label>내 수집 주소<input readOnly value={url} onFocus={e => e.target.select()} aria-label="수집 주소"/></label>
        <div className="ingest-actions"><button type="button" className="primary" onClick={() => copy(url, 'url')}>{copied === 'url' ? '복사했어요 ✓' : '주소 복사'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { if (window.confirm('새 주소를 만들면 폰에 넣어 둔 이전 주소는 더 이상 동작하지 않아요. 계속할까요?')) run(async () => { const d = await supabase!.from('hg_ingest_tokens').delete().eq('family_id', familyId).eq('user_id', userId); if (d.error) throw d.error; const i = await supabase!.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }); if (i.error) throw i.error; await load(); }); }}>주소 새로 만들기</button>
          <button type="button" className="text-button danger" disabled={busy} onClick={() => { if (window.confirm('자동 수집을 끌까요? 폰의 자동화는 더 이상 저장되지 않아요.')) run(async () => { const d = await supabase!.from('hg_ingest_tokens').delete().eq('family_id', familyId).eq('user_id', userId); if (d.error) throw d.error; await load(); }); }}>끄기</button></div>
        <small className="muted">주소에 든 토큰은 비밀번호처럼 다뤄 주세요. 지금까지 {token.received.toLocaleString('ko-KR')}건 저장{token.last_used_at ? ` · 마지막 수신 ${ago(token.last_used_at)}` : ''}</small>
      </> : <button type="button" className="primary" disabled={busy} onClick={() => run(async () => { const i = await supabase!.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }); if (i.error) throw i.error; await load(); })}>자동 수집 주소 만들기</button>}
    </section>

    <section className="wizard-step" aria-label="2단계 폰 자동화">
      <h4><span className="step-no">2</span>폰에 자동화 넣기{connected && <span className="step-done">✓</span>}</h4>
      <div className="chips" role="group" aria-label="기기 선택">{(Object.keys(DEVICE_LABEL) as Device[]).map(d => <button type="button" key={d} className={`chip ${device === d ? 'on' : ''}`} aria-pressed={device === d} onClick={() => setDevice(d)}>{DEVICE_LABEL[d]}</button>)}</div>
      <details className="recipe" open={!connected}><summary>{connected ? '설정 방법 다시 보기' : '설정 방법'}</summary>
        {device === 'iphone-push' && <>
          {ios && major !== null && major < IOS_NOTIFICATION_TRIGGER_MIN && <p className="recipe-warn">이 아이폰은 iOS {ios}이에요. 카드앱 알림 자동화는 <b>iOS {IOS_NOTIFICATION_TRIGGER_MIN}</b>부터 돼요 — 설정 → 일반 → 소프트웨어 업데이트. 그동안은 <b>아이폰 · 문자</b> 방법으로 받을 수 있어요.</p>}
          {ios && major !== null && major >= IOS_NOTIFICATION_TRIGGER_MIN && <p className="recipe-ok">이 아이폰은 iOS {ios} ✓ 카드앱 알림을 바로 받을 수 있어요.</p>}
          <p>어느 카드앱 알림을 받을까요?</p>
          <div className="chips" role="group" aria-label="카드앱 선택">{CARD_APPS.map(a => <button type="button" key={a} className={`chip ${apps.includes(a) ? 'on' : ''}`} aria-pressed={apps.includes(a)} onClick={() => setApps(v => v.includes(a) ? v.filter(x => x !== a) : [...v, a])}>{a}</button>)}</div>
          <ol>
            <li><b>카드앱 알림 켜기</b> — {appList} 안의 설정 → 알림에서 승인(결제) 알림을 켜고, 아이폰 설정 → 알림에서도 그 앱을 허용해요.</li>
            <li><b>단축어 받기</b> — 두 버튼을 차례로 누르면 단축어 앱이 열리고 “내 수집 주소” 질문이 떠요. 그 칸에 <b>붙여넣기</b> → <b>단축어 추가</b>. 타이핑은 없어요.
              <div className="ingest-actions">{token && <button type="button" className="secondary" onClick={() => copy(url, 'url2')}>{copied === 'url2' ? '복사했어요 ✓' : '① 주소 복사'}</button>}<a className="button-link" href="/haraguri-collect.shortcut" target="_blank" rel="noopener" download="하라구리 수집.shortcut">② 단축어 받기</a></div>
              <small className="muted">홈 화면 앱에서 누르면 Safari가 열려요. 내려받은 파일을 누르면 단축어 앱으로 넘어가요.</small></li>
            <li><b>자동화 연결</b> — 단축어 앱 → 자동화 → ＋ → 목록 아래쪽 <b>알림</b>(“알림을 받을 때”) → 앱에서 {appList} 선택{apps.length > 1 && ' (한 번에 여러 앱이 안 되면 앱마다 하나씩)'} → <b>즉시 실행</b> → 다음 → 목록에서 <b>하라구리 수집</b> 선택. 끝.</li>
            <li>다음 결제 알림이 오면 아래 3단계에 <b>연결됨 ✓</b>가 떠요. 알림이 올 때 화면 위에 자동화 실행 띠가 잠깐 보이는 건 iOS 정책이에요.</li>
          </ol>
          <details className="recipe-manual"><summary>단축어를 직접 만들려면</summary><ol>
            <li>자동화의 <b>새로운 빈 자동화</b> → 동작 검색 <b>URL 콘텐츠 가져오기</b> → URL 칸에 수집 주소 붙여넣기 → 화살표를 눌러 펼치고 방법 <b>POST</b> · 요청 본문 <b>JSON</b></li>
            <li><b>새로운 필드 추가 → 텍스트</b> 하나만: 키 <code>body</code>, 값은 키보드 위 변수 줄에서 <b>단축어 입력</b>(받은 알림)을 선택.</li>
          </ol></details>
          <p className="muted">카드사 이름이 같이 안 들어오면 확인 대기에서 카드를 한 번만 골라 주세요. Apple Pay만 쓰는 카드는 자동화 트리거 <b>거래</b>에 같은 <b>하라구리 수집</b> 단축어를 연결하면 돼요.</p>
        </>}
        {device === 'iphone-sms' && <>
          <p className="muted">카드사 알림을 문자로 받는 경우예요. 카드앱 푸시만 오면 카드사 설정에서 ‘문자 알림’을 켜거나, iOS {IOS_NOTIFICATION_TRIGGER_MIN} 이상이면 <b>아이폰 · 카드앱 알림</b>을 쓰세요.</p>
          <ol>
            <li><b>단축어 받기</b> — 두 버튼을 차례로 누르면 단축어 앱이 열리고 “내 수집 주소” 질문이 떠요. 그 칸에 <b>붙여넣기</b> → <b>단축어 추가</b>.
              <div className="ingest-actions">{token && <button type="button" className="secondary" onClick={() => copy(url, 'url3')}>{copied === 'url3' ? '복사했어요 ✓' : '① 주소 복사'}</button>}<a className="button-link" href="/haraguri-collect.shortcut" target="_blank" rel="noopener" download="하라구리 수집.shortcut">② 단축어 받기</a></div></li>
            <li><b>자동화 연결</b> — 단축어 앱 → 자동화 → ＋ → <b>메시지</b> → “메시지에 다음 포함”에 <code>승인</code> (또는 <code>원</code>) → <b>즉시 실행</b> → 다음 → 목록에서 <b>하라구리 수집</b> 선택. 끝.</li>
            <li>다음 승인 문자가 오면 아래 3단계에 <b>연결됨 ✓</b>가 떠요.</li>
          </ol>
          <details className="recipe-manual"><summary>단축어를 직접 만들려면</summary><p><b>새로운 빈 자동화</b> → <b>URL 콘텐츠 가져오기</b> → URL에 수집 주소 → 방법 <b>POST</b> → 요청 본문 <b>JSON</b> → 필드 <code>body</code> = <b>단축어 입력</b></p></details>
        </>}
        {device === 'galaxy' && <>
          <ol>
            <li>Play 스토어에서 <b>MacroDroid</b> 설치 → 매크로 추가</li>
            <li>트리거 <b>알림 수신</b> → 카드앱{apps.length ? `(${apps.join(', ')})` : ''}·카카오톡 선택. 문자도 받으려면 트리거 <b>SMS 수신</b>(내용에 “승인”/“출금”)을 하나 더 추가</li>
            <li>동작 <b>HTTP 요청</b> → POST → URL에 위 주소 {token && <button type="button" className="text-button inline-copy" onClick={() => copy(url, 'url4')}>{copied === 'url4' ? '복사했어요 ✓' : '주소 복사'}</button>} → 콘텐츠 유형 JSON → 본문 <code>{galaxyBody}</code> <button type="button" className="text-button inline-copy" onClick={() => copy(galaxyBody, 'gx')}>{copied === 'gx' ? '복사했어요 ✓' : '본문 복사'}</button></li>
            <li>문자 트리거의 본문은 <code>{'{"text":"[sms_message]","via":"android"}'}</code></li>
          </ol>
        </>}
      </details>
    </section>

    <section className="wizard-step" aria-label="3단계 연결 확인">
      <h4><span className="step-no">3</span>연결 확인{connected && <span className="step-done">✓</span>}</h4>
      {!token ? <p className="muted">먼저 1단계에서 주소를 만들어 주세요.</p> : <>
        <p className="inbox-verdict" role="status">
          {connected ? <><b>{DEVICE_LABEL[device]} 연결됨 ✓</b> · 마지막 {ago(proof!.received_at)}{proof!.app ? ` · ${appName(proof!.app)}` : ''}</>
            : latest ? <>아직 <b>{DEVICE_LABEL[device]}</b>에서 온 건 없어요 · 마지막 수신 {ago(latest.received_at)} ({VIA_LABEL[latest.via] ?? latest.via})</>
            : <>아직 도착한 게 없어요. 카드로 결제하거나 카드앱 알림이 오면 여기 바로 떠요.</>}
          {unparsed.length > 0 && <> · <b className="usage-warn">못 읽음 {unparsed.length}건</b></>}
        </p>
        <div className="ingest-actions"><button type="button" className="secondary" disabled={testing} onClick={sendTest}>{testing ? '보내는 중…' : '연결 테스트 보내기'}</button></div>
        {inbox.length > 0 && <ul className="inbox-list">{inbox.slice(0, 8).map(r => <li key={r.id} className={`inbox-row ${r.status}`}>
          <span className={`inbox-status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
          <span className="inbox-meta">{ago(r.received_at)} · {VIA_LABEL[r.via] ?? r.via}{r.app ? ` · ${appName(r.app)}` : ''}</span>
          <small className={r.status === 'unparsed' ? 'raw-text' : ''}>{r.status === 'unparsed' ? r.raw : r.summary}</small>
          {r.status === 'unparsed' && <span className="inbox-actions"><button type="button" className="text-button" onClick={() => copy(r.raw, r.id)}>{copied === r.id ? '복사했어요 ✓' : '원문 복사'}</button><button type="button" className="text-button" onClick={() => remove(r)}>지우기</button></span>}
        </li>)}</ul>}
        {unparsed.length > 0 && <p className="muted">못 읽은 알림은 원문 그대로 남겨 두니, 가계부에 직접 적거나 원문을 복사해 알려 주시면 읽는 법을 더해요.</p>}
      </>}
    </section>
  </div>;
}
