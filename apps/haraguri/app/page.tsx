'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { startKakaoLogin } from '../lib/kakao';
import { KakaoGlyph } from '../components/KakaoGlyph';
import { supabase } from '../lib/supabase';
import { Attachment, Card, Expense, Data, Entry, Family, daysInMonth, demoData, emptyData, money, monthEntries, today, total } from '../lib/model';

import { CardFields, ExpenseFields, FinancePanel } from '../components/Finance';
import { Planner } from '../components/Planner';
import { Chat } from '../components/Chat';
import { WorkBoard, WorkFields, ExpenseWorkFields } from '../components/Work';
import { Room, inRoom, purchaseStates, workExpenses } from '../lib/work';
import { occurrence } from '../lib/model';
import { parseThresholds, validateQualifyingAmount } from '../lib/finance';

type Tab = 'home' | 'calendar' | 'money' | 'chat' | 'alerts' | 'settings';
type FormKind = 'entry' | 'expense' | 'card' | null;
const tabs: [Tab, string, string][] = [['home', '⌂', '우리집'], ['calendar', '▦', '일정·할 일'], ['money', '₩', '가계부'], ['chat', '◌', '대화'], ['settings', '⚙', '가족 설정']];
const tables: [keyof Data, string][] = [['entries', 'hg_entries'], ['members', 'hg_members'], ['receipts', 'hg_receipts'], ['cards', 'hg_cards'], ['expenses', 'hg_expenses'], ['comments', 'hg_comments'], ['attachments', 'hg_attachments']];
const repeatLabel = { none: '한 번', monthly: '매월', yearly: '매년' };

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId=useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close();}} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={close} aria-label="닫기">×</button></div>{children}
  </dialog>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [demo, setDemo] = useState(false);
  const [family, setFamily] = useState<Family | null>(null);
  const [spaces,setSpaces]=useState<Family[]>([]);
  const [activeSpace,setActiveSpace]=useState('');
  const [spaceAction,setSpaceAction]=useState<'create'|'join'>('create');
  const [data, setData] = useState<Data>(emptyData);
  const [tab, setTab] = useState<Tab>('home');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [entryDate,setEntryDate]=useState('');
  const [form, setForm] = useState<FormKind>(null);
  const [editingCard,setEditingCard] = useState<Card|null>(null);
  const [editingExpense,setEditingExpense] = useState<Expense|null>(null);
  const [expenseRoom,setExpenseRoom]=useState<Room>(null);
  const [sync,setSync]=useState('연결 준비 중');
  const [chatView,setChatView]=useState<'general'|'work'>('general');
  function openExpense(expense: Expense|null = null, room:Room=null) { setExpenseRoom(room); setSelected(null); setEditingExpense(expense); setError(''); setForm('expense'); }
  function openCard(card: Card|null = null) { setEditingCard(card); setError(''); setForm('card'); }
  const [selectedRoom, setSelected] = useState<Room>(null);
  const selected = selectedRoom ? {entry:data.entries.find(e=>e.id===selectedRoom.entry.id) || selectedRoom.entry,date:selectedRoom.date} : null;
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [invite, setInvite] = useState('');
  const requestVersion = useRef(0);
  useEffect(()=>{window.scrollTo({top:0});},[tab]);
  const uid = demo ? 'demo' : user?.id ?? '';

  const load = useCallback(async () => {
    if (!supabase || !user || demo) return;
    const request = ++requestVersion.current;
    setLoading(true);
    try {
      const result = await supabase.from('hg_families').select('*').order('created_at');
      if (result.error) throw result.error;
      if (request !== requestVersion.current) return;
      const available=result.data as Family[];
      setSpaces(available);
      const remembered=activeSpace || localStorage.getItem(`haraguri-space-${user.id}`);
      const current=available.find(f=>f.id===remembered) || available[0] || null;
      setFamily(current);
      if (!current) { setData(emptyData); return; }
      const fid = current.id;
      const results = await Promise.all(tables.map(async ([key, table]) => {
        const collected: unknown[] = [];
        for (let offset = 0; offset < 2000; offset += 500) {
          const r = await supabase!.from(table).select('*').eq('family_id', fid)
            .order(key === 'members' ? 'user_id' : 'id').range(offset, offset + 499);
          if (r.error) throw r.error;
          collected.push(...(r.data ?? []));
          if ((r.data?.length ?? 0) < 500) return [key, collected] as const;
        }
        throw new Error('조회 범위를 초과했습니다. 전체 기록을 표시하려면 조회 범위 확장이 필요합니다.');
      }));
      if (request === requestVersion.current) setData(Object.fromEntries(results) as Data);
    } catch (e) {
      if (request === requestVersion.current) setData(emptyData);
      throw e;
    } finally { if (request === requestVersion.current) setLoading(false); }
  }, [user, demo, activeSpace]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (!supabase) { setAuthReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      setUser(data.session?.user ?? null); setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) requestVersion.current++;
      setUser(session?.user ?? null); setAuthReady(true);
      if (!session) { setFamily(null); setSpaces([]); setActiveSpace(''); setData(emptyData); setSelected(null); setInvite(''); }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load().catch(e => setError(e.message)); };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load]);

  useEffect(()=>{
    if(demo){setSync('미리보기');return;}
    if(!supabase||!family?.id||!user)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>load().catch(e=>setError(e.message)),150);};
    const channel=supabase.channel(`family-chat-${family.id}`);
    for(const table of ['hg_comments','hg_attachments','hg_entries','hg_expenses','hg_receipts']) channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`family_id=eq.${family.id}`},refresh);
    channel.subscribe(status=>{setSync(status==='SUBSCRIBED'?'실시간 연결됨':'연결 중 · 30초마다 새로고침');if(status==='SUBSCRIBED')refresh();});
    return()=>{clearTimeout(timer);void supabase!.removeChannel(channel);};
  },[family?.id,user?.id,demo,load]);

  async function run(action: () => Promise<void>) {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try { await action(); return true; } catch (e) { setError(e instanceof Error ? e.message : (e as { message?: string }).message ?? '처리하지 못했습니다. 다시 시도해 주세요.'); return false; }
    finally { setBusy(false); }
  }
  async function insert(key: keyof Data, table: string, value: Record<string, unknown>) {
    if (demo) {
      setData(d => ({ ...d, [key]: [...d[key], { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...value }] }));
    } else {
      const { error } = await supabase!.from(table).insert(value);
      if (error) throw error;
      await load();
    }
  }
  async function update(key: 'cards'|'expenses'|'entries', table: string, id: string, value: Record<string, unknown>) {
    if (demo) setData(d => ({...d, [key]: d[key].map(row => row.id === id ? {...row,...value} : row)}));
    else {
      const result = await supabase!.from(table).update(value).eq('id',id).select('id').single();
      if (result.error) throw result.error;
      await load();
    }
  }
  function switchSpace(id:string) {
    if(busy||id===family?.id)return;
    requestVersion.current++;setSelected(null);setForm(null);setInvite('');setNotice('');setError('');setData(emptyData);setFamily(null);setLoading(true);
    setActiveSpace(id);if(user)localStorage.setItem(`haraguri-space-${user.id}`,id);
  }
  function startDemo() {
    requestVersion.current++;
    setDemo(true); setData(demoData()); setFamily({ id: 'demo', name: '우리 가족', owner_id: 'demo' }); setSpaces([{id:'demo',name:'우리 가족',owner_id:'demo'}]); setError('');
  }
  const name = (id: string) => data.members.find(m => m.user_id === id)?.display_name ?? '가족';
  const rows = monthEntries(data.entries, month);
  const currentRows = monthEntries(data.entries, today().slice(0, 7));
  const done = (id: string, date: string) => data.receipts.some(r => r.entry_id === id && r.occurrence === date && r.state === 'done');
  const unseen = currentRows.filter(({ entry, date }) => !data.receipts.some(r => r.entry_id === entry.id && r.occurrence === date && r.user_id === uid && r.state === 'seen'));
  const due = currentRows.filter(({ entry, date }) => date <= today() && !done(entry.id, date));

  async function receipt(state: 'seen' | 'done') {
    if (!selected) return;
    const existing = data.receipts.find(r => r.entry_id === selected.entry.id && r.occurrence === selected.date && r.user_id === uid && r.state === state);
    if (existing) {
      if (demo) setData(d => ({ ...d, receipts: d.receipts.filter(r => r.id !== existing.id) }));
      else { const r = await supabase!.from('hg_receipts').delete().eq('id', existing.id); if (r.error) throw r.error; await load(); }
    } else await insert('receipts', 'hg_receipts', { family_id: family!.id, entry_id: selected.entry.id, occurrence: selected.date, user_id: uid, state });
  }
  async function upload(file: File) {
    if (demo) throw new Error('미리보기에서는 파일을 저장하지 않습니다. 로그인 후 이용해 주세요.');
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!allowed.includes(file.type)) throw new Error('JPG, PNG, WEBP, PDF, TXT, DOCX, XLSX 파일을 올려주세요.');
    if (file.size > 10 * 1024 * 1024) throw new Error('파일은 10MB 이하로 올려주세요.');
    const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const path = `${family!.id}/${uid}/${crypto.randomUUID()}.${extension}`;
    const uploaded = await supabase!.storage.from('haraguri-files').upload(path, file);
    if (uploaded.error) throw uploaded.error;
    const r = await supabase!.from('hg_attachments').insert({ family_id: family!.id, entry_id: selected?.entry.id ?? null, occurrence: selected?.date ?? null, path, name: file.name, created_by: uid });
    if (r.error) { await supabase!.storage.from('haraguri-files').remove([path]); throw r.error; }
    await load();
  }
  async function openFile(file: Attachment) {
    const r = await supabase!.storage.from('haraguri-files').createSignedUrl(file.path, 60, { download: file.name });
    if (r.error) throw r.error;
    const link = document.createElement('a'); link.href = r.data.signedUrl; link.rel = 'noopener'; link.click();
  }
  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    const str = (key: string) => String(values.get(key) ?? '').trim();
    await run(async () => {
      const common = { family_id: family!.id, created_by: uid };
      if (form === 'entry') {
        if (!str('title')) throw new Error('제목을 입력해 주세요.');
        await insert('entries', 'hg_entries', { ...common, title: str('title'), body: str('body'), date: str('date'), kind: str('kind'), repeat: str('repeat') || 'none', assignee: str('assignee') || null, expected_amount: Number(str('expected_amount')) });
      } else if (form === 'expense') {
        const amount = Number(str('amount'));
        if (!str('title') || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1000000000) throw new Error('사용처와 올바른 원 단위 금액을 입력해 주세요.');
        const qualifying = !str('card_id') || str('qualifying_mode') === 'auto' ? null : str('qualifying_mode') === 'exclude' ? 0 : Number(str('qualifying_amount'));
        validateQualifyingAmount(amount, qualifying);
        if (str('payment_method')==='card' && !str('card_id')) throw new Error('카드를 선택해 주세요.');
        const entry=data.entries.find(e=>e.id===str('entry_id'));
        if(entry && occurrence(entry,str('occurrence').slice(0,7))!==str('occurrence')) throw new Error('반복 일정의 실제 회차 날짜를 선택해 주세요.');
        const value = {entry_id: entry?.id || null, occurrence: entry?str('occurrence'):null, payment_method: str('payment_method'), title: str('title'), amount, date: str('date'), category: str('category'), card_id: str('card_id') || null, qualifying_amount: qualifying, performance_month: str('card_id') && str('performance_month') ? `${str('performance_month')}-01` : null};
        if (editingExpense) await update('expenses','hg_expenses',editingExpense.id,value);
        else await insert('expenses','hg_expenses',{...common,...value});
      } else {
        const budget = Number(str('budget'));
        const creditLimit = Number(str('credit_limit'));
        if (!Number.isSafeInteger(creditLimit) || creditLimit < 0 || creditLimit > 1000000000) throw new Error('카드 한도를 올바른 원 단위 금액으로 입력해 주세요.');
        if (!str('name') || !Number.isSafeInteger(budget) || budget < 0 || budget > 1000000000) throw new Error('카드 이름과 올바른 월 예산을 입력해 주세요.');
        const value = {card_type: str('card_type'), name: str('name'), holder: str('holder'), budget, credit_limit: creditLimit, owner_user_id: str('owner_user_id') || null, performance_thresholds: parseThresholds(str('performance_thresholds')), benefit_basis: str('benefit_basis'), excluded_categories: values.getAll('excluded_categories').map(String), benefit_note: str('benefit_note')};
        if (editingCard) await update('cards','hg_cards',editingCard.id,value);
        else await insert('cards','hg_cards',{family_id: family!.id,...value});
      }
      setForm(null); if(form==='expense'&&expenseRoom)setSelected(expenseRoom); setNotice(demo ? '미리보기에 반영했어요. 새로고침하면 초기화됩니다.' : '저장했어요.');
    });
  }
  function renderEntry(entry: Entry, date: string) {
    return <button key={`${entry.id}-${date}`} className="entry" onClick={() => { setError(''); setSelected({ entry, date }); }}>
      <span className={`entry-icon ${done(entry.id, date) ? 'complete' : entry.kind}`}>{done(entry.id, date) ? '✓' : entry.kind === 'task' ? '□' : entry.kind==='purchase'?'🛒':'◷'}</span>
      <span className="entry-copy"><strong>{entry.title}</strong><small>{date.slice(5).replace('-', '.')} · {entry.assignee ? name(entry.assignee) : '함께'} {entry.repeat !== 'none' && `· ${repeatLabel[entry.repeat]}`}</small></span>
      <span className="entry-end">{done(entry.id, date) ? '완료' : '›'}</span>
    </button>;
  }
  const banners = <>{error && <div role="alert" className="banner error">{error}<button onClick={() => setError('')} aria-label="오류 닫기">×</button></div>}{notice && <div role="status" className="banner">{notice}</div>}</>;

  if (!authReady) return <main className="auth"><div className="brand">HARAGURI<span>우리 가족의 하루</span></div><p>가족 공간을 준비하고 있어요…</p></main>;
  if (!demo && !user) return <main className="auth"><div className="brand">HARAGURI<span>우리 가족의 하루</span></div><section className="auth-card">
    <div className="eyebrow">A LITTLE CLOSER, EVERY DAY</div><h1>함께 챙기는 일상,<br/>차곡차곡 쌓이는 우리.</h1><p>이번 달 할 일부터 오늘 쓴 생활비까지.<br/>가족에게 필요한 이야기를 한곳에 모아요.</p>{banners}
    {supabase ? <><button className="kakao-button" disabled={busy} onClick={()=>run(()=>startKakaoLogin())}><KakaoGlyph/>{busy?'카카오로 연결 중…':'카카오 로그인'}</button><p className="login-note">이메일 입력 없이 카카오 계정으로 시작해요.<br/>처음이라면 로그인 후 모임을 만들거나 초대 코드로 참여하세요.</p></> : <p className="setup-note">아직 로그인 연결 설정이 준비되지 않았어요. 먼저 미리보기로 둘러보세요.</p>}
    <button className="secondary" onClick={startDemo}>로그인 없이 미리보기 ↗</button><small>미리보기의 기록은 저장되지 않습니다.</small>
  </section></main>;

  if (!family) return <main className="auth"><div className="brand">HARAGURI<span>우리 가족의 하루</span></div><section className="auth-card"><h1>우리 가족을 모아볼까요?</h1>{banners}{loading ? <p>가족 정보를 확인하고 있어요…</p> : <form onSubmit={e => { e.preventDefault(); const v = new FormData(e.currentTarget); const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement; run(async () => {
      const memberName = String(v.get('display_name')).trim();
      const r = button.value === 'join' ? await supabase!.rpc('hg_join_family', { invite_code: v.get('invite'), member_name: memberName }) : await supabase!.rpc('hg_create_family', { family_name: v.get('family_name'), member_name: memberName });
      if (r.error) throw r.error; setActiveSpace(r.data); localStorage.setItem(`haraguri-space-${uid}`,r.data); await load();
    }); }}><label>가족에게 보여줄 이름<input name="display_name" required maxLength={40} defaultValue={user?.user_metadata?.name || user?.user_metadata?.nickname || ''} placeholder="이름 또는 애칭"/></label><label>새 가족 공간 이름<input name="family_name" defaultValue="우리 가족" maxLength={80}/></label><button className="primary" value="create" disabled={busy}>가족 공간 만들기</button><div className="divider">또는 초대받으셨나요?</div><label>초대 코드<input name="invite" placeholder="가족에게 받은 코드를 붙여넣으세요"/></label><button className="secondary" value="join" disabled={busy}>초대 코드로 참여하기</button></form>}<button className="text-button" onClick={() => run(async () => { const r = await supabase!.auth.signOut(); if (r.error) throw r.error; })}>로그아웃</button></section></main>;

  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="/">HARAGURI<span>우리 가족의 하루</span></a><div className="family-label">{family.name}<span>{data.members.length}명이 함께해요</span></div><nav aria-label="주 메뉴">{tabs.map(([key, icon, title]) => <button key={key} aria-label={title} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span>{icon}</span>{title}{key === 'alerts' && unseen.length > 0 && <b>{unseen.length}</b>}</button>)}</nav><div className="sidebar-note">작은 일도 함께 나누면<br/>조금 더 가벼워지니까.</div><div className="profile"><span className="avatar">{name(uid).slice(0, 1)}</span><div>{name(uid)}<small>오늘도 반가워요</small></div></div></aside>
    <main className="main">
      <header className="topbar"><span className="mobile-brand">HARAGURI</span><button className="text-button" aria-label="확인할 알림" onClick={()=>setTab('alerts')}>알림 {unseen.length || ''}</button><span className="date-label">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</span><div className="avatars">{data.members.map(m => <span className="avatar" title={m.display_name} key={m.user_id}>{m.display_name.slice(0, 1)}</span>)}</div></header>
      <div className="space-switcher"><label>현재 모임<select aria-label="현재 모임" value={family.id} disabled={busy||demo} onChange={e=>switchSpace(e.target.value)}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="text-button" onClick={()=>setTab('settings')}>＋ 모임 만들기·참여</button></div>
      {demo && <div className="demo-banner">미리보기 · 입력한 내용은 새로고침하면 초기화됩니다.<button onClick={() => { setDemo(false); setFamily(null); setData(emptyData); setSelected(null); setForm(null); }}>로그인하기 ↗</button></div>}
      {banners}
      <div className="page-heading"><div><div className="eyebrow">OUR LITTLE FAMILY SPACE</div><h1>{tab === 'home' ? '우리의 하루를 함께.' : tab==='alerts'?'알림':tabs.find(t => t[0] === tab)?.[2]}</h1><p>{tab === 'home' ? '챙겨야 할 일도, 기억하고 싶은 순간도 여기에.' : tab === 'money' ? '오늘의 지출을 기록하고, 이번 달 생활비를 함께 살펴봐요.' : tab === 'calendar' ? '매달 돌아오는 할 일과 소중한 약속을 놓치지 않게.' : tab === 'chat' ? '가족 기본 채팅과 일정·구매별 대화를 함께 살펴봐요.' : tab === 'alerts' ? '확인이 필요한 일정과 아직 끝내지 못한 일을 모았어요.' : '가족을 초대하고 함께 쓰는 공간을 관리해요.'}</p></div>{(tab === 'home' || tab === 'calendar') && <button className="primary" onClick={() => {setEntryDate('');setForm('entry');}}>＋ 일정·할 일</button>}{tab === 'money' && <button className="primary" onClick={() => openExpense()}>＋ 지출 기록</button>}</div>
      {loading && <p role="status" className="muted">최신 기록을 불러오는 중…</p>}
      {tab === 'home' && <>
        <div className="stats"><section className="stat peach"><span>오늘 쓴 돈</span><strong>{money(total(data.expenses, today()))}</strong><small>직접 기록한 결제·환불 기준</small></section><section className="stat mint"><span>이번 달 지출</span><strong>{money(total(data.expenses, today().slice(0, 7)))}</strong><small>가족이 함께 기록한 생활비</small></section><section className="stat lavender"><span>오늘까지 챙길 일</span><strong>{due.length}<em>개</em></strong><small>이번 달 미완료 일정·할 일</small></section></div>
        <WorkBoard title={family.name.includes('가족')?'우리집 일':'모임의 일'} data={data} month={today().slice(0,7)} compact onMore={()=>{setTab('chat');setChatView('work');}} onOpen={(entry,date)=>setSelected({entry,date})} onCreate={()=>{setEntryDate('');setForm('entry');}}/>
        <div className="home-grid"><section className="panel"><div className="section-head"><h2>놓치지 말고 챙겨요 <span className="count">{due.length}</span></h2><button className="text-button" onClick={() => setTab('calendar')}>전체 보기 ↗</button></div>{due.length ? due.slice(0, 5).map(({ entry, date }) => renderEntry(entry, date)) : <div className="empty">오늘까지 할 일을 모두 챙겼어요 🌿</div>}<div className="gentle-note">확인과 완료는 따로 기록해요.<br/>반복되는 할 일도 매달 새롭게 체크할 수 있어요.</div></section>
        <section className="panel"><div className="section-head"><h2>최근 지출</h2><button className="text-button" onClick={() => setTab('money')}>가계부 ↗</button></div>{[...data.expenses].sort((a,b) => b.date.localeCompare(a.date)).slice(0,4).map(e => <div className="expense-row" key={e.id}><span className="expense-icon">₩</span><div><strong>{e.title}</strong><small>{e.date.slice(5)} · {e.category}</small></div><b>{money(e.amount)}</b></div>)}{!data.expenses.length && <div className="empty">첫 생활비를 기록해 보세요.</div>}<button className="wide-button" onClick={() => openExpense()}>＋ 지출 기록하기</button></section></div>
        <section className="panel"><div className="section-head"><h2>이번 달 함께할 순간</h2><span className="muted">{today().slice(0,7).replace('-', '. ')}</span></div>{currentRows.filter(r => r.date >= today()).slice(0,4).map(({ entry, date }) => renderEntry(entry, date))}{!currentRows.some(r => r.date >= today()) && <div className="empty">가족과 함께할 다음 일정을 등록해 보세요.</div>}</section>
      </>}
      {tab === 'calendar' && <Planner data={data} month={month} setMonth={setMonth} onOpen={(entry,date)=>setSelected({entry,date})} onCreate={date=>{setEntryDate(date);setForm('entry');}}/>}
      {tab === 'money' && <FinancePanel entries={data.entries} onOpenWork={(entry,date)=>setSelected({entry,date})} cards={data.cards} expenses={data.expenses} uid={uid} month={month} setMonth={setMonth} busy={busy} onAddCard={()=>openCard()} onEditCard={openCard} onEditExpense={openExpense} onDeleteExpense={expense=>{
        if(!window.confirm('이 지출 기록을 삭제할까요?')) return;
        run(async()=>{if(demo) setData(d=>({...d,expenses:d.expenses.filter(e=>e.id!==expense.id)})); else {const r=await supabase!.from('hg_expenses').delete().eq('id',expense.id);if(r.error)throw r.error;await load();}});
      }}/>}
      {tab === 'chat' && <>
        <div className="payment-tabs" role="group" aria-label="대화 종류"><button aria-pressed={chatView==='general'} onClick={()=>setChatView('general')}>가족 기본 채팅</button><button aria-pressed={chatView==='work'} onClick={()=>setChatView('work')}>일정·구매별 대화</button></div>
        {chatView==='work'?<WorkBoard title={family.name.includes('가족')?'우리집 일':'모임의 일'} data={data} month={month} onOpen={(entry,date)=>setSelected({entry,date})} onCreate={()=>{setEntryDate('');setForm('entry');}}/>:!selected&&<div className="panel"><Chat key="general" room={null} comments={data.comments} attachments={data.attachments} entries={data.entries} uid={uid} name={name} busy={busy} sync={sync} onOpen={(entry,date)=>setSelected({entry,date})} onSend={body=>run(()=>insert('comments','hg_comments',{family_id:family.id,entry_id:null,occurrence:null,body,created_by:uid}))} onUpload={file=>run(()=>upload(file))} onFile={file=>run(()=>openFile(file))}/></div>}
      </>}
      {tab === 'alerts' && <><div className="banner">앱 안에서 확인하는 알림 모음입니다. 앱을 닫았을 때의 예약 푸시는 아직 제공하지 않습니다.</div><section className="panel"><h2>이번 달 아직 확인하지 않았어요</h2>{unseen.map(({entry,date}) => renderEntry(entry,date))}{!unseen.length && <div className="empty">모든 일정을 확인했어요.</div>}<h2 className="list-title">오늘까지 미완료</h2>{due.map(({entry,date}) => renderEntry(entry,date))}{!due.length && <div className="empty">밀린 일이 없어요.</div>}</section></>}
      {tab === 'settings' && <section className="panel settings"><h2>모임 공간</h2><p>가족·친구·행사별로 독립된 공간을 만들어요. 대화, 일정, 카드와 지출은 선택한 모임 멤버끼리만 공유합니다.</p>
        <div className="payment-tabs"><button aria-pressed={spaceAction==='create'} onClick={()=>setSpaceAction('create')}>새 모임 만들기</button><button aria-pressed={spaceAction==='join'} onClick={()=>setSpaceAction('join')}>초대 코드로 참여</button></div>
        <form key={spaceAction} onSubmit={e=>{e.preventDefault();const v=new FormData(e.currentTarget);run(async()=>{
          if(demo)throw new Error('실제 모임 생성·참여는 로그인 후 이용해 주세요.');
          const r=spaceAction==='create'?await supabase!.rpc('hg_create_family',{family_name:v.get('space_name'),member_name:v.get('member_name')}):await supabase!.rpc('hg_join_family',{invite_code:v.get('space_invite'),member_name:v.get('member_name')});
          if(r.error)throw r.error;
          requestVersion.current++;setSelected(null);setInvite('');setData(emptyData);setFamily(null);setLoading(true);setActiveSpace(r.data);localStorage.setItem(`haraguri-space-${uid}`,r.data);setTab('home');
        });}}><label>이 모임에서 사용할 이름<input name="member_name" required maxLength={40} defaultValue={name(uid)}/></label>{spaceAction==='create'?<label>모임 이름<input name="space_name" required maxLength={80} placeholder="우리 가족 / 부모님 생신 / 친구 여행"/></label>:<label>모임 초대 코드<input name="space_invite" required placeholder="초대 코드를 붙여넣으세요"/></label>}<button className="primary" disabled={busy}>{spaceAction==='create'?'모임 생성하기':'모임 참여하기'}</button></form>
        <h2 className="list-title">{family.name}</h2>{data.members.map(m => <div className="member-row" key={m.user_id}><span className="avatar">{m.display_name.slice(0,1)}</span><strong>{m.display_name}</strong><small>{m.user_id === family.owner_id ? '가족 공간 소유자' : '가족 구성원'}</small></div>)}{family.owner_id === uid && <><h2 className="list-title">가족 초대</h2><p>새 코드를 발급하면 이전 코드는 만료됩니다. 코드는 7일 동안 유효해요.</p><button className="primary" disabled={busy} onClick={() => run(async () => { if(demo) throw new Error('실제 가족 초대는 로그인 후 사용할 수 있어요.'); const r = await supabase!.rpc('hg_invite',{family:family.id}); if(r.error) throw r.error; setInvite(r.data); })}>초대 코드 발급</button>{invite && <label>가족에게 전달할 코드<input readOnly value={invite} onFocus={e => e.target.select()}/></label>}</>}{!demo&&<><h2 className="list-title">로그인 계정</h2>{user?.identities?.some(i=>i.provider==='kakao')?<p>카카오 계정이 연결되어 있어요.</p>:<><p>기존 기록을 유지하려면 현재 계정에 카카오 로그인을 연결하세요.</p><button className="kakao-button" disabled={busy} onClick={()=>run(()=>startKakaoLogin(true))}><KakaoGlyph/>카카오 계정 연결</button></>}</>}<h2 className="list-title">홈 화면에 설치</h2><p>iPhone은 Safari 공유 메뉴에서 ‘홈 화면에 추가’를, Android는 브라우저 메뉴의 ‘앱 설치’를 선택하세요.</p><h2 className="list-title">기록 공유</h2><p>가족 공간의 일정, 지출, 댓글과 첨부파일은 참여한 가족 모두에게 공유됩니다.</p><button className="secondary" disabled={busy} onClick={() => run(async () => { if(!demo) { const r = await supabase!.auth.signOut(); if(r.error) throw r.error; } setDemo(false); setFamily(null); setSpaces([]); setActiveSpace(''); setData(emptyData); setSelected(null); setInvite(''); })}>{demo ? '미리보기 나가기' : '로그아웃'}</button></section>}
      <footer>HARAGURI <span>우리 가족의 작은 기록들</span></footer>
    </main>
    <nav className="bottom-nav" aria-label="모바일 메뉴">{tabs.map(([key,icon,title]) => <button key={key} aria-label={title} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={() => setTab(key)}><span>{icon}</span>{title}</button>)}</nav>
    {form && <Modal title={form==='entry'?'함께할 일 남기기':form==='expense'?(editingExpense?'지출 수정하기':'지출 기록하기'):(editingCard?'카드 설정':'카드·실적 목표 추가')} close={()=>{if(!busy)setForm(null);}}>
      <form onSubmit={submitForm}>{error&&<p role="alert" className="error banner">{error}</p>}
        {form==='card'?<CardFields card={editingCard} members={data.members}/>:form==='expense'?<><ExpenseFields expense={editingExpense} cards={data.cards}/><ExpenseWorkFields entries={data.entries} expense={editingExpense} room={expenseRoom}/></>:<WorkFields members={data.members} date={entryDate || today()}/>}
        <button className="primary" disabled={busy}>{busy?'저장 중…':'저장하기'}</button>
      </form>
    </Modal>}
    {selected && !form && <Modal title={selected.entry.title} close={()=>{if(!busy)setSelected(null);}}>
      <div className="detail work-detail">{error&&<p role="alert" className="error banner">{error}</p>}
        <button className="text-button" onClick={e=>e.currentTarget.closest('dialog')?.querySelector('.chat-room')?.scrollIntoView({block:'start',behavior:'smooth'})}>대화 바로가기 ↓</button><div className="detail-meta">{selected.date} · {repeatLabel[selected.entry.repeat]} · {selected.entry.assignee?name(selected.entry.assignee):'함께'}</div>
        <p className="body-copy">{selected.entry.body || '함께 이야기하며 내용을 채워보세요.'}</p>
        <div className="work-money"><span>예상 금액<strong>{money(selected.entry.expected_amount || 0)}</strong></span><span>연결된 실제 지출<strong>{money(workExpenses(data.expenses,selected).reduce((sum,e)=>sum+Number(e.amount),0))}</strong></span></div>
        {selected.entry.kind==='purchase'&&<label>구매 진행<select aria-label="구매 진행" value={selected.entry.purchase_state || 'discussing'} disabled={busy} onChange={e=>run(()=>update('entries','hg_entries',selected.entry.id,{purchase_state:e.target.value}))}>{Object.entries(purchaseStates).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><small className="muted">구매 완료로 바꿔도 지출이 자동 생성되지 않아요. 실제 결제를 아래에 연결하세요.</small></label>}
        <div className="detail-actions">{(['seen','done'] as const).map(state=>{const mine=data.receipts.some(r=>r.entry_id===selected.entry.id&&r.occurrence===selected.date&&r.user_id===uid&&r.state===state);return <button key={state} className={mine?'primary':'secondary'} aria-pressed={mine} disabled={busy} onClick={()=>run(()=>receipt(state))}>{mine?'✓ ':''}{state==='seen'?'확인했어요':'완료했어요'}</button>;})}</div>
        <div className="receipt-list">{data.receipts.filter(r=>inRoom(r,selected)).map(r=><span key={r.id}>{name(r.user_id)} · {r.state==='seen'?'확인':'완료'}</span>)}</div>
        <button className="secondary" disabled={busy} onClick={()=>run(async()=>{await insert('comments','hg_comments',{family_id:family.id,entry_id:null,occurrence:null,shared_entry_id:selected.entry.id,shared_occurrence:selected.date,body:`${selected.entry.title} 함께 확인해 주세요.`,created_by:uid});setSelected(null);setTab('chat');setChatView('general');})}>가족 기본 채팅에 공유</button>
        <h3>관련 지출</h3>{workExpenses(data.expenses,selected).map(e=><div className="expense-row" key={e.id}><div><strong>{e.title}</strong><small>{e.date} · {e.category}</small></div><b>{money(e.amount)}</b>{e.created_by===uid&&<button className="text-button" onClick={()=>openExpense(e,selected)}>수정</button>}</div>)}
        <div className="work-expense-actions"><button className="secondary" onClick={()=>openExpense(null,selected)}>＋ 결제·환불 기록</button><label>기존 지출 연결<select aria-label="기존 지출 연결" value="" disabled={busy} onChange={e=>{const id=e.target.value;if(id)run(()=>update('expenses','hg_expenses',id,{entry_id:selected.entry.id,occurrence:selected.date}));}}><option value="">이미 입력한 지출 선택</option>{data.expenses.filter(e=>e.created_by===uid&&!e.entry_id).map(e=><option key={e.id} value={e.id}>{e.date} · {e.title} · {money(e.amount)}</option>)}</select></label></div>
        <Chat key={`${selected.entry.id}-${selected.date}`} room={selected} comments={data.comments} attachments={data.attachments} entries={data.entries} uid={uid} name={name} busy={busy} sync={sync} onOpen={(entry,date)=>setSelected({entry,date})} onSend={body=>run(()=>insert('comments','hg_comments',{family_id:family.id,entry_id:selected.entry.id,occurrence:selected.date,body,created_by:uid}))} onUpload={file=>run(()=>upload(file))} onFile={file=>run(()=>openFile(file))}/>
        {selected.entry.created_by===uid&&<button className="text-button danger" disabled={busy} onClick={()=>{if(!window.confirm('이 일과 반복 회차의 대화·확인 기록을 모두 삭제할까요?'))return;run(async()=>{
          if(data.attachments.some(f=>f.entry_id===selected.entry.id)||data.expenses.some(e=>e.entry_id===selected.entry.id)||data.comments.some(c=>c.shared_entry_id===selected.entry.id))throw new Error('사진·지출·공유 대화가 연결된 일은 삭제할 수 없어요.');
          if(demo)setData(d=>({...d,entries:d.entries.filter(e=>e.id!==selected.entry.id),comments:d.comments.filter(c=>c.entry_id!==selected.entry.id),receipts:d.receipts.filter(r=>r.entry_id!==selected.entry.id)}));else{const r=await supabase!.from('hg_entries').delete().eq('id',selected.entry.id);if(r.error)throw r.error;await load();}setSelected(null);
        });}}>일정 전체 삭제</button>}
      </div>
    </Modal>}
  </div>;
}
