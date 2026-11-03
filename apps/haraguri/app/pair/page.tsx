'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { canRetryPairing, NOTIFICATION_SHORTCUT_NAME, parseShortcutRelease, shortcutPairingURL } from '../../lib/shortcuts';

type Family = { id: string; name: string };
export default function PairPage() {
  const started = useRef(false);
  const [message, setMessage] = useState('로그인·가족 확인 중…');
  const [login, setLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [families, setFamilies] = useState<Family[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(family: string) {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('hg_create_shortcut_pairing', { family });
      if (error || !data || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) throw new Error('연결 코드를 만들지 못했어요. 다시 시도해 주세요.');
      const release = parseShortcutRelease(await fetch('/haraguri-notifications.json', { cache: 'no-store' }).then(r => r.json()));
      const mode = release?.name_normalization ?? 'NFD';
      launch(shortcutPairingURL(data.code, NOTIFICATION_SHORTCUT_NAME, mode, window.location.origin));
    } catch (e) { setMessage(e instanceof Error ? e.message : '연결하지 못했어요.'); }
    finally { setBusy(false); }
  }
  function launch(url: string) {
    setLink(url);
    setMessage('단축어에서 허용 질문이 나오면 허용해 주세요. 자동으로 열리지 않으면 아래 버튼을 누르세요.');
    window.location.href = url;
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Remove the short-lived code before loading account data or following links.
    const params = new URLSearchParams(window.location.search);
    const current = params.has('code') ? window.location.search : sessionStorage.getItem('haraguri-pair-return') || '';
    const callback = new URLSearchParams(current);
    window.history.replaceState(null, '', '/pair');
    async function begin() {
      if (!supabase) { setMessage('연결 설정을 불러오지 못했어요.'); return; }
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError) throw new Error('로그인을 확인하지 못했어요. 다시 시도해 주세요.');
      if (!auth.session) {
        if (current) sessionStorage.setItem('haraguri-pair-return', current);
        setLogin(true); setMessage('단축어에 연결할 하라구리 계정으로 로그인해 주세요.'); return;
      }
      sessionStorage.removeItem('haraguri-pair-return');
      const code = callback.get('code');
      if (code) {
        if (!/^[0-9a-f]{48}$/.test(code)) throw new Error('잘못된 연결 코드예요.');
        const status = await supabase.rpc('hg_shortcut_pairing_status', { pair_code: code });
        if (status.error) throw new Error('연결 상태를 확인하지 못했어요. 자동 재시도는 중단했어요.');
        if (status.data === 'claimed') {
          localStorage.setItem('haraguri-shortcut-normalization', callback.get('shortcutNormalization') === 'NFD' ? 'NFD' : callback.get('shortcutNormalization') === 'NFC' ? 'NFC' : localStorage.getItem(`haraguri-pair-mode-${code}`) || 'NFC');
          setMessage('연결됐어요 ✓ 가계부 탭으로 돌아가면 “연결됨”이 보이고, 다음 카드 알림부터 자동으로 올라와요.'); return;
        }
        const key = `haraguri-pair-retried-${code}`;
        if (canRetryPairing(status.data, localStorage.getItem(key) === '1', callback.get('pairRetry'))) {
          localStorage.setItem(key, '1');
          const mode = callback.get('pairRetry') === 'nfc' ? 'NFC' : 'NFD';
          localStorage.setItem(`haraguri-pair-mode-${code}`, mode);
          launch(shortcutPairingURL(code, NOTIFICATION_SHORTCUT_NAME, mode, window.location.origin, true)); return;
        }
        throw new Error(status.data === 'expired' || status.data === 'missing' ? '연결 코드가 만료됐어요. 가족 설정에서 다시 연결해 주세요.' : '단축어를 열지 못했어요. 이름을 “하라구리 알림 수집”으로 다시 입력한 뒤 가족 설정에서 연결해 주세요.');
      }
      const result = await supabase.from('hg_families').select('id,name').order('created_at');
      if (result.error) throw new Error('가족을 확인하지 못했어요.');
      const available = (result.data || []) as Family[];
      setFamilies(available);
      const remembered = localStorage.getItem(`haraguri-space-${auth.session.user.id}`);
      const family = available.find(f => f.id === remembered) || (available.length === 1 ? available[0] : null);
      if (family) await create(family.id);
      else setMessage(available.length ? '알림을 저장할 가족·모임을 골라 주세요.' : '하라구리에서 가족·모임을 먼저 만들어 주세요.');
    }
    void begin().catch(e => setMessage(e instanceof Error ? e.message : '연결하지 못했어요. 다시 시도해 주세요.'));
  }, []);

  async function signIn() {
    if (!supabase || busy) return;
    setBusy(true);
    sessionStorage.setItem('haraguri-auth-next', 'pair');
    const result = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setMessage(result.error ? '로그인 메일을 보내지 못했어요. 이메일과 연결을 확인해 주세요.' : '이 브라우저에서 로그인 메일을 열어 주세요. 로그인 뒤 계정 연결을 계속해요.');
    setBusy(false);
  }
  return <main style={{ maxWidth: 480, margin: 'auto', padding: '32px 20px' }}>
    <h1>하라구리 계정 연결</h1><p role="status">{message}</p>
    {login && <form onSubmit={e => { e.preventDefault(); void signIn(); }}><label>이메일<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></label><button disabled={busy} type="submit">로그인 메일 받기</button></form>}
    {!login && !link && families.length > 0 && <ul>{families.map(f => <li key={f.id}><button disabled={busy} onClick={() => { void create(f.id); }}>{f.name}에 연결</button></li>)}</ul>}
    {link && <a className="button-link primary" href={link}>단축어로 연결 계속하기</a>}
    <p><a href="/?tab=money&collect=1">하라구리 가계부로 돌아가기</a></p>
  </main>;
}
