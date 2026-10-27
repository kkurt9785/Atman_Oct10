'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Per-member collect address for phone automations. The token is shown once per load; rotating it invalidates the old one.
export function IngestSetup({ familyId, userId, busy, run }: { familyId: string; userId: string; busy: boolean; run: (a: () => Promise<void>) => Promise<boolean> }) {
  const [token, setToken] = useState<{ token: string; received: number; last_used_at: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  async function load() {
    if (!supabase) return;
    const r = await supabase.from('hg_ingest_tokens').select('token,received,last_used_at').eq('family_id', familyId).eq('user_id', userId).maybeSingle();
    setToken(r.data ?? null); setLoaded(true);
  }
  useEffect(() => { load(); }, [familyId, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = token ? `${base}/functions/v1/ingest?token=${token.token}` : '';
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }
  if (!loaded) return <p className="muted">수집 주소를 확인하고 있어요…</p>;
  return <div className="ingest-setup">
    <p className="muted">결제 문자·알림을 폰이 자동으로 이 주소에 보내면, 가계부에 <b>확인 대기</b>로 올라와요. 주소에 든 토큰은 비밀번호처럼 다뤄 주세요.</p>
    {token ? <>
      <label>내 수집 주소<input readOnly value={url} onFocus={e => e.target.select()} aria-label="수집 주소"/></label>
      <div className="ingest-actions"><button type="button" className="primary" onClick={copy}>{copied ? '복사했어요 ✓' : '주소 복사'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { if (window.confirm('새 주소를 만들면 폰에 넣어 둔 이전 주소는 더 이상 동작하지 않아요. 계속할까요?')) run(async () => { const d = await supabase!.from('hg_ingest_tokens').delete().eq('family_id', familyId).eq('user_id', userId); if (d.error) throw d.error; const i = await supabase!.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }); if (i.error) throw i.error; await load(); }); }}>주소 새로 만들기</button>
        <button type="button" className="text-button danger" disabled={busy} onClick={() => { if (window.confirm('자동 수집을 끌까요? 폰의 자동화는 더 이상 저장되지 않아요.')) run(async () => { const d = await supabase!.from('hg_ingest_tokens').delete().eq('family_id', familyId).eq('user_id', userId); if (d.error) throw d.error; await load(); }); }}>끄기</button></div>
      <small className="muted">지금까지 {token.received.toLocaleString('ko-KR')}건 수신{token.last_used_at ? ` · 마지막 ${new Date(token.last_used_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</small>
    </> : <button type="button" className="primary" disabled={busy} onClick={() => run(async () => { const i = await supabase!.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }); if (i.error) throw i.error; await load(); })}>자동 수집 주소 만들기</button>}
    <details className="ingest-guide"><summary>폰에 연결하는 방법</summary>
      <h4>iPhone · 단축어 앱 (문자)</h4>
      <ol><li>단축어 → 자동화 → ＋ → <b>메시지</b> → "메시지에 다음 포함" 에 <code>승인</code> (또는 <code>원</code>) → <b>즉시 실행</b> 켜기</li><li>동작에서 <b>URL 콘텐츠 가져오기</b> 추가 → URL에 위 주소 붙여넣기 → 방법 <b>POST</b> → 요청 본문 <b>JSON</b> → 키 <code>text</code>, 값 <b>단축어 입력</b></li><li>Apple Pay를 쓰면 자동화 트리거 <b>거래</b>로도 같은 동작을 만들 수 있어요(가맹점·금액이 바로 와요)</li></ol>
      <h4>갤럭시 · MacroDroid (문자 + 카톡 알림)</h4>
      <ol><li>트리거: <b>SMS 수신</b> (내용에 "승인"/"출금") 또는 <b>알림 수신</b> → 카카오톡·카드앱 선택</li><li>동작: <b>HTTP 요청</b> → POST → 위 주소 → 본문 <code>{'{"text":"[sms_message]"}'}</code> (알림은 <code>[not_text]</code>)</li></ol>
      <p className="muted">카드사·은행 로그인 정보는 어디에도 저장하지 않아요. 문자 원문은 확인을 돕기 위해 지출에 함께 보관돼요.</p>
    </details>
  </div>;
}
