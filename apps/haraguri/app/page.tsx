'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { startKakaoLogin } from '../lib/kakao';
import { KakaoGlyph } from '../components/KakaoGlyph';
import { supabase } from '../lib/supabase';
import { Attachment, Card, Expense, Data, Entry, Envelope, Family, Pin, Reaction, Comment, RecurringExpense, daysInMonth, demoChat, demoData, emptyData, money, monthEntries, today, total } from '../lib/model';

import { BudgetFields, CardFields, EnvelopeFields, ExpenseFields, FinancePanel, FinanceView, RecurringFields, SmsPaste } from '../components/Finance';
import { CaptureImport, ImportRow } from '../components/CaptureImport';
import type { OcrRow } from '../lib/ocr';
import { budgetFor, budgetStatus } from '../lib/budget';
import { PushPrefs } from '../components/PushPrefs';
import { AutoCollectBanner, AutoCollectCard, AutoCollectStatus, AutoCollectSummary } from '../components/AutoCollect';
import { useAutoCollect } from '../lib/autocollect';
import { monthlyReport } from '../lib/report';
import { SharedItems, sharedFlag, takeSharedItems } from '../lib/share';
import { parseCardMessage } from '../lib/cardsms';
import { PushState, currentSubscription, disablePush, enablePush, pushSupport, syncPush } from '../lib/push';
import { dayTone, holidayName, weekOf } from '../lib/holidays';
import { memberColor } from '../lib/colors';
import { Planner } from '../components/Planner';
import { Chat } from '../components/Chat';
import { RoomSummary, WorkBoard, WorkFields, ExpenseWorkFields } from '../components/Work';
import { Room, inRoom, isClosed, looksFinished, purchaseStates, roomDate, roomState, workExpenses } from '../lib/work';
import { occurrence } from '../lib/model';
import { categories, learnKeyword, parseThresholds, validateQualifyingAmount } from '../lib/finance';
import { DemoChat, SearchHit, emptySocial, listRoomFiles, useRoomMessages, useRoomSocial, useSignedPhotos } from '../lib/chat';
import { formatBytes, prepareUpload, thumbPath } from '../lib/image';

type Tab = 'home' | 'calendar' | 'money' | 'chat' | 'settings';
type FormKind = 'entry' | 'expense' | 'card' | 'recurring' | 'budget' | 'envelope' | null;
type InviteRow = { family_id: string; family_name: string; invited_by_name: string; matched: string };
type TargetRow = { id: string; target: string; expires_at: string };
type UnreadRow = { family_id: string; family_name: string; entry_id: string | null; occurrence: string | null; room_title: string; unread: number; latest_at: string; latest_body: string | null; latest_author: string | null };
// 설정은 탭이 아니라 상단 ⚙ 버튼(모바일)·사이드바 맨 아래(데스크톱)로 간다. 하단 탭은 매일 쓰는 네 개만.
const tabs: [Tab, string, string][] = [['home', '⌂', '우리집'], ['calendar', '▦', '일정·할 일'], ['money', '₩', '가계부'], ['chat', '◌', '대화']];
// Snapshot tables: [key, table, order column, ascending, tiebreak column for stable paging]. Newest first so the 2,000-row window keeps recent records.
const tables: [keyof Data, string, string, boolean, string | null][] = [['entries', 'hg_entries', 'date', false, 'id'], ['members', 'hg_members', 'user_id', true, null], ['receipts', 'hg_receipts', 'occurrence', false, 'id'], ['cards', 'hg_cards', 'name', true, 'id'], ['expenses', 'hg_expenses', 'date', false, 'id'], ['rooms', 'hg_rooms', 'occurrence', false, 'entry_id'], ['recurring', 'hg_recurring_expenses', 'day_of_month', true, 'id'], ['budgets', 'hg_budgets', 'month', false, null], ['rules', 'hg_category_rules', 'keyword', true, 'id'], ['envelopes', 'hg_envelopes', 'created_at', false, 'id'], ['envelopeEntries', 'hg_envelope_entries', 'date', false, 'id'], ['settlements', 'hg_settlements', 'month', false, null]];
const tableLabel: Record<keyof Data, string> = { entries: '일정·할 일', members: '멤버', receipts: '확인 기록', cards: '카드', expenses: '지출', rooms: '대화 상태', recurring: '반복 지출', budgets: '예산', rules: '분류 규칙', envelopes: '적립 봉투', envelopeEntries: '적립 기록', settlements: '정산' };
const ROW_CAP = 2000;
const FREE_STORAGE_BYTES = 1024 ** 3;
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
  const [live,setLive]=useState(false);
  const [chatView,setChatView]=useState<'general'|'work'>('general');
  const [chatVersion,setChatVersion]=useState(0);
  const [demoRooms,setDemoRooms]=useState<DemoChat>({comments:[],attachments:[]});
  const [demoSocial,setDemoSocial]=useState<{reactions:Reaction[];pins:Record<string,Pin&{comment:Comment|null}>}>({reactions:[],pins:{}});
  const [truncated,setTruncated]=useState<(keyof Data)[]>([]);
  const [editingEntry,setEditingEntry]=useState<Entry|null>(null);
  const [entryLocked,setEntryLocked]=useState(false);
  const [emailMode,setEmailMode]=useState(false);
  const [emailAddr,setEmailAddr]=useState('');
  const [usage,setUsage]=useState<{files:number;bytes:number;limit:number}|null>(null);
  const [expensePrefill,setExpensePrefill]=useState<Partial<Expense>|null>(null);
  const [prefillText,setPrefillText]=useState('');
  const [prefillKey,setPrefillKey]=useState(0);
  const [shared,setShared]=useState<SharedItems|null>(null);
  const [shareDest,setShareDest]=useState('general');
  const [push,setPush]=useState<PushState>('unsupported');
  const [deepLink,setDeepLink]=useState<{tab?:Tab;open?:string;collect?:boolean}|null>(null);
  const [plannerFocus,setPlannerFocus]=useState<string|null>(null);
  const [financeView,setFinanceView]=useState<FinanceView>('list');
  const [collectOpen,setCollectOpen]=useState(false);
  const [pendingInvite,setPendingInvite]=useState<string>('');
  const [invites,setInvites]=useState<InviteRow[]>([]); // 모임 주인이 내 닉네임·이메일을 적어 둔 초대 — 로그인하면 바로 보인다
  const [targets,setTargets]=useState<TargetRow[]>([]);
  const [codeMode,setCodeMode]=useState(false); // login screen: paste an invite code/link before signing in
  const [recurringPrefill,setRecurringPrefill]=useState<{title:string;amount:number;day:number}|null>(null);
  const [captureOpen,setCaptureOpen]=useState(false); // screenshot → transactions importer
  const [captureFiles,setCaptureFiles]=useState<File[]|null>(null); // handed over from the share sheet
  const [aiReady,setAiReady]=useState(false); // the vision function says whether an API key is configured
  useEffect(()=>{ if(!captureOpen||demo||!supabase) return; supabase.auth.getSession().then(({data:{session}})=>fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/vision`,{headers:{Authorization:`Bearer ${session?.access_token ?? ''}`}})).then(r=>r.ok?r.json():null).then(b=>setAiReady(!!b?.configured)).catch(()=>setAiReady(false)); },[captureOpen,demo]);
  const [unread,setUnread]=useState<UnreadRow[]>([]); // rooms with messages this person has not opened yet (all spaces)
  const [focusTick,setFocusTick]=useState(0); // bumps when the app comes back to the foreground so the open room is marked read again
  const inviteLink=(code:string)=>`${window.location.origin}/?invite=${code}`;
  function rememberInvite(raw:string){ // accepts a bare code or a whole invite link
    const code=raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if(!code){ setError('초대 코드 형식이 아니에요. 가족이 보낸 링크나 코드를 그대로 붙여넣어 주세요.'); return; }
    try{localStorage.setItem('haraguri-invite',code);}catch{}
    setPendingInvite(code); setCodeMode(false); setError(''); setNotice('초대 코드를 기억했어요. 이제 로그인만 하면 바로 참여돼요.');
  }
  const kakaoName=()=>String(user?.user_metadata?.name||user?.user_metadata?.nickname||user?.user_metadata?.full_name||'가족').slice(0,40);
  async function refreshPush(){const support=pushSupport();if(support!=='off'){setPush(support);return;}setPush((await currentSubscription())&&Notification.permission==='granted'?'on':'off');}
  const bumpChat=()=>setChatVersion(v=>v+1);
  function openExpense(expense: Expense|null = null, room:Room=null, text='') { setExpenseRoom(room); setSelected(null); setEditingExpense(expense); setExpensePrefill(null); setPrefillText(text); setPrefillKey(k=>k+1); setError(''); setForm('expense'); }
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
  const common=()=>({ family_id: family!.id, created_by: uid });
  const lastPayKey=`haraguri-last-pay-${uid}`; // the expense form starts from the payment method/card used last time
  const readLastPay=()=>{ try{ return JSON.parse(localStorage.getItem(lastPayKey)||'null') as {payment_method?:string;card_id?:string}|null; }catch{ return null; } };

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
      const capped: (keyof Data)[] = [];
      const results = await Promise.all(tables.map(async ([key, table, column, ascending, tiebreak]) => {
        const collected: unknown[] = [];
        for (let offset = 0; offset < ROW_CAP; offset += 500) {
          let query = supabase!.from(table).select('*').eq('family_id', fid).order(column, { ascending });
          if (tiebreak) query = query.order(tiebreak);
          const r = await query.range(offset, offset + 499);
          if (r.error) throw r.error;
          collected.push(...(r.data ?? []));
          if ((r.data?.length ?? 0) < 500) return [key, collected] as const;
        }
        // Keep the app usable with the newest window instead of failing every screen.
        capped.push(key);
        return [key, collected] as const;
      }));
      if (request === requestVersion.current) { setData(Object.fromEntries(results) as Data); setTruncated(capped); }
    } catch (e) {
      if (request === requestVersion.current) setData(emptyData);
      throw e;
    } finally { if (request === requestVersion.current) setLoading(false); }
  }, [user, demo, activeSpace]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Notification taps arrive as /?tab=… or /?open=entryId:occurrence; applied once the family snapshot is loaded.
    const params = new URLSearchParams(window.location.search);
    // Invite links: remember the code through the Kakao round-trip, then join automatically after login.
    const inviteParam = params.get('invite');
    if (inviteParam && /^[0-9a-f-]{36}$/i.test(inviteParam)) { try { localStorage.setItem('haraguri-invite', inviteParam); } catch { /* private mode */ } }
    try { const stored = localStorage.getItem('haraguri-invite'); if (stored) setPendingInvite(stored); } catch { /* ignore */ }
    if (inviteParam) window.history.replaceState(null, '', '/');
    if (params.get('tab') || params.get('open') || params.get('review') || params.get('collect')) { if (params.get('review')) setFinanceView('review'); setDeepLink({ tab: (params.get('tab') as Tab | null) ?? (params.get('review') || params.get('collect') ? 'money' : undefined), open: params.get('open') ?? undefined, collect: !!params.get('collect') }); window.history.replaceState(null, '', '/'); }
    refreshPush();
    // Items handed over from the Android share sheet (service worker POST /share → cache → here).
    const flag = sharedFlag(window.location.search);
    if (flag) {
      window.history.replaceState(null, '', '/');
      if (flag === 'ok') takeSharedItems().then(items => { if (items && (items.files.length || items.text)) setShared(items); else setNotice('공유받은 항목을 찾지 못했어요. 다시 공유해 주세요.'); }).catch(() => setError('공유받은 항목을 읽지 못했어요.'));
      else if (flag === 'unsupported') setNotice('공유 받기는 홈 화면에 설치한 HARAGURI(Android)에서 열렸을 때 동작해요. iPhone은 사진을 저장한 뒤 ＋ 사진·문서로 골라 주세요.');
      else setError('공유받은 항목을 저장하지 못했어요. 다시 시도해 주세요.');
    }
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
    const refresh = () => { if (document.visibilityState === 'visible') { load().catch(e => setError(e.message)); bumpChat(); } };
    refresh();
    // Realtime carries changes; polling is only a safety net, so it slows down while connected.
    const timer = setInterval(refresh, live ? 120000 : 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load, live]);

  useEffect(()=>{
    if(demo){setSync('미리보기');return;}
    if(!supabase||!family?.id||!user)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let chatTimer:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>load().catch(e=>setError(e.message)),150);};
    const refreshChat=()=>{clearTimeout(chatTimer);chatTimer=setTimeout(bumpChat,150);};
    const channel=supabase.channel(`family-chat-${family.id}`);
    for(const table of ['hg_comments','hg_attachments','hg_reactions','hg_pins','hg_room_reads']) channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`family_id=eq.${family.id}`},refreshChat);
    for(const table of ['hg_entries','hg_expenses','hg_receipts','hg_rooms','hg_budgets','hg_category_rules','hg_envelopes','hg_envelope_entries','hg_settlements']) channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`family_id=eq.${family.id}`},refresh);
    channel.subscribe(status=>{const ok=status==='SUBSCRIBED';setLive(ok);setSync(ok?'실시간 연결됨':'연결 중 · 30초마다 새로고침');if(ok){refresh();refreshChat();}});
    return()=>{clearTimeout(timer);clearTimeout(chatTimer);setLive(false);void supabase!.removeChannel(channel);};
  },[family?.id,user?.id,demo,load]);
  // Usage is read on the settings tab and after uploads so the composer can warn before the quota trigger refuses a file.
  useEffect(()=>{
    if(demo||!supabase||!family?.id){setUsage(null);return;}
    if(tab!=='settings'&&usage!==null&&chatVersion===0)return;
    supabase.rpc('hg_storage_usage',{family:family.id}).then(r=>{const row=Array.isArray(r.data)?r.data[0]:r.data;if(!r.error&&row)setUsage({files:Number(row.files),bytes:Number(row.bytes),limit:Number(row.limit_bytes ?? FREE_STORAGE_BYTES)});});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tab,demo,family?.id,chatVersion]);
  const usagePercent=usage&&usage.limit?Math.min(100,Math.round(usage.bytes/usage.limit*100)):0;

  async function enterSpace(id:string){
    requestVersion.current++; setSelected(null); setInvite(''); setActiveSpace(id); try{localStorage.setItem(`haraguri-space-${uid}`,id);}catch{}
    setFamily(null); setData(emptyData); setLoading(true); setTab('home'); await load();
  }
  async function acceptInvite(inv:InviteRow){
    const memberName=kakaoName();
    const r=await supabase!.rpc('hg_accept_invite',{family:inv.family_id,member_name:memberName});
    if(r.error) throw r.error;
    setInvites(list=>list.filter(i=>i.family_id!==inv.family_id));
    setNotice(`'${inv.family_name}' 모임에 참여했어요. 이름은 가족 설정에서 바꿀 수 있어요 (지금: ${memberName}).`);
    await enterSpace(r.data);
  }
  useEffect(()=>{
    if(!pendingInvite||!user||demo||!supabase||busy)return;
    const code=pendingInvite; setPendingInvite(''); try{localStorage.removeItem('haraguri-invite');}catch{}
    run(async()=>{
      const memberName=kakaoName();
      const r=await supabase!.rpc('hg_join_family',{invite_code:code,member_name:memberName});
      if(r.error){ if(/이미 참여/.test(r.error.message)) setNotice('이미 참여한 모임이에요.'); else throw new Error(`초대 링크로 참여하지 못했어요: ${r.error.message}`); return; }
      setNotice(`초대받은 모임에 참여했어요. 이름은 가족 설정에서 바꿀 수 있어요 (지금: ${memberName}).`);
      await enterSpace(r.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[pendingInvite,user?.id,demo,busy]);
  useEffect(()=>{ // targeted invites: re-check whenever the user or their space list changes
    if(!supabase||!user||demo){setInvites([]);return;}
    supabase.rpc('hg_my_invites').then(r=>{ if(!r.error) setInvites((r.data as InviteRow[])||[]); });
  },[user?.id,demo,spaces.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ setTargets([]); },[family?.id]);
  const refreshUnread=useCallback(async()=>{ if(!supabase||!user||demo){setUnread([]);return;} const r=await supabase.rpc('hg_unread_summary',{target:user.id}); if(!r.error) setUnread((r.data as UnreadRow[])||[]); },[user?.id,demo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ refreshUnread(); },[refreshUnread,spaces.length,chatVersion,focusTick]);
  useEffect(()=>{ const onShow=()=>{ if(document.visibilityState==='visible') setFocusTick(t=>t+1); }; document.addEventListener('visibilitychange',onShow); window.addEventListener('focus',onShow); return ()=>{ document.removeEventListener('visibilitychange',onShow); window.removeEventListener('focus',onShow); }; },[]);
  const unreadAll=unread.reduce((n,r)=>n+r.unread,0);
  const unreadMap=Object.fromEntries(unread.filter(r=>r.family_id===family?.id).map(r=>[`${r.entry_id ?? 'general'}:${r.occurrence ?? ''}`,r.unread])) as Record<string,number>;
  const unreadFamilyTotal=Object.values(unreadMap).reduce((n,c)=>n+c,0);
  const unreadGeneral=unreadMap['general:']||0;
  // Dismiss delivered push notifications by tag (KakaoTalk-style: reading the room clears its banners from the notification center).
  const closeNotifications=(tags:string[]|null)=>{ try{ navigator.serviceWorker?.ready.then(reg=>reg.getNotifications().then(list=>list.forEach(n=>{ if(!tags||tags.includes(n.tag)) n.close(); }))).catch(()=>undefined); }catch{} };
  useEffect(()=>{ if(!demo&&user&&unreadAll===0) closeNotifications(null); },[unreadAll,demo,user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ // home-screen icon badge (iOS 16.4+/Android); the service worker sets it on push, the app corrects it when it is open
    const nav=navigator as Navigator&{setAppBadge?:(n:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};
    if(demo||!nav.setAppBadge) return; (unreadAll>0?nav.setAppBadge(unreadAll):nav.clearAppBadge?.())?.catch(()=>undefined);
  },[unreadAll,demo]);
  useEffect(()=>{
    if(demo||!supabase||!family?.id||tab!=='settings'||family.owner_id!==uid)return;
    supabase.from('hg_invite_targets').select('id,target,expires_at').eq('family_id',family.id).order('created_at').then(r=>{ if(!r.error) setTargets(r.data as TargetRow[]); });
  },[tab,demo,family?.id,family?.owner_id,uid]);
  useEffect(()=>{ if(tab!=='calendar') setPlannerFocus(null); },[tab]); // the week-strip hand-off applies once; leaving the tab clears it
  useEffect(()=>{ if(user&&!demo) syncPush(user.id).then(ok=>{ if(ok) setPush('on'); }).catch(()=>{}); },[user?.id,demo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!deepLink||!family||loading)return;
    if(deepLink.tab&&['home','calendar','money','chat','settings'].includes(deepLink.tab))setTab(deepLink.tab);
    if(deepLink.collect)setCollectOpen(true);
    if(deepLink.open){const [id,date]=deepLink.open.split(':');const entry=data.entries.find(e=>e.id===id);if(entry)setSelected({entry,date:date||entry.date});}
    setDeepLink(null);
  },[deepLink,family,loading,data.entries]);

  const general=useRoomMessages({familyId:family?.id ?? '',room:null,demo,demoChat:demoRooms,version:chatVersion,enabled:!!family&&tab==='chat'&&chatView==='general'});
  const generalSocialLive=useRoomSocial({familyId:family?.id ?? '',room:null,commentIds:general.comments.map(c=>c.id),demo,version:chatVersion,enabled:!!family&&tab==='chat'&&chatView==='general'});
  const detail=useRoomMessages({familyId:family?.id ?? '',room:selected,demo,demoChat:demoRooms,version:chatVersion,enabled:!!family&&!!selected});
  const detailSocialLive=useRoomSocial({familyId:family?.id ?? '',room:selected,commentIds:detail.comments.map(c=>c.id),demo,version:chatVersion,enabled:!!family&&!!selected});
  const roomKeyOf=(room:Room)=>`${room?.entry.id ?? 'general'}:${room?.date ?? ''}`;
  const socialFor=(room:Room,live:typeof generalSocialLive)=>demo?{reactions:demoSocial.reactions,reads:[],pin:demoSocial.pins[roomKeyOf(room)]??null}:live;
  const collect=useAutoCollect(family?.id ?? '',uid,!demo&&!!family&&!!user);
  const [highlightId,setHighlightId]=useState<string|null>(null);
  // Reactions toggle, pins replace per room, search is a plain ilike over the family's messages; demo keeps them in memory.
  async function react(commentId:string,emoji:string){
    if(demo){ setDemoSocial(d=>{ const hit=d.reactions.find(r=>r.comment_id===commentId&&r.user_id===uid&&r.emoji===emoji); return {...d,reactions:hit?d.reactions.filter(r=>r!==hit):[...d.reactions,{id:crypto.randomUUID(),comment_id:commentId,user_id:uid,emoji}]}; }); return; }
    const mine=[...generalSocialLive.reactions,...detailSocialLive.reactions].find(r=>r.comment_id===commentId&&r.user_id===uid&&r.emoji===emoji);
    const r=mine?await supabase!.from('hg_reactions').delete().eq('id',mine.id):await supabase!.from('hg_reactions').insert({family_id:family!.id,comment_id:commentId,emoji});
    if(r.error) throw r.error; bumpChat();
  }
  async function pinMessage(room:Room,commentId:string){
    if(demo){ const c=demoRooms.comments.find(x=>x.id===commentId)??null; setDemoSocial(d=>({...d,pins:{...d.pins,[roomKeyOf(room)]:{comment_id:commentId,pinned_by:uid,pinned_at:new Date().toISOString(),comment:c}}})); return; }
    const r=await supabase!.rpc('hg_pin_message',{comment:commentId}); if(r.error) throw r.error; bumpChat();
  }
  async function unpin(room:Room){
    if(demo){ setDemoSocial(d=>{ const pins={...d.pins}; delete pins[roomKeyOf(room)]; return {...d,pins}; }); return; }
    let q=supabase!.from('hg_pins').delete().eq('family_id',family!.id); q=room?q.eq('entry_id',room.entry.id).eq('occurrence',room.date):q.is('entry_id',null).is('occurrence',null);
    const r=await q; if(r.error) throw r.error; bumpChat();
  }
  async function photoUrl(file:Attachment){ if(demo||!supabase) return null; const r=await supabase.storage.from('haraguri-files').createSignedUrl(file.path,300); return r.data?.signedUrl ?? null; }
  async function searchMessages(q:string):Promise<SearchHit[]>{
    const title=(entryId:string|null)=>entryId?(data.entries.find(e=>e.id===entryId)?.title ?? '우리집 일'):'가족 기본 채팅';
    if(demo) return demoRooms.comments.filter(c=>c.body.toLocaleLowerCase().includes(q.toLocaleLowerCase())).slice(0,50).map(c=>({id:c.id,body:c.body,created_by:c.created_by,created_at:c.created_at,entry_id:c.entry_id,occurrence:c.occurrence,room_title:title(c.entry_id)}));
    const r=await supabase!.from('hg_comments').select('id,body,created_by,created_at,entry_id,occurrence').eq('family_id',family!.id).ilike('body',`%${q.replace(/[%_]/g,'')}%`).order('created_at',{ascending:false}).limit(50);
    if(r.error) throw r.error; return (r.data as Comment[]).map(c=>({id:c.id,body:c.body,created_by:c.created_by,created_at:c.created_at,entry_id:c.entry_id,occurrence:c.occurrence,room_title:title(c.entry_id)}));
  }
  function jumpToHit(hit:SearchHit){
    setHighlightId(hit.id); window.setTimeout(()=>setHighlightId(h=>h===hit.id?null:h),4000);
    if(hit.entry_id){ const entry=data.entries.find(e=>e.id===hit.entry_id); if(entry) setSelected({entry,date:hit.occurrence||entry.date}); }
    else { setSelected(null); setTab('chat'); setChatView('general'); }
  }
  useEffect(()=>{
    if(!supabase||!family||demo||!user) return;
    const room=selected?{entry:selected.entry.id,occ:selected.date}:(tab==='chat'&&chatView==='general')?{entry:null,occ:null}:null;
    if(!room||document.visibilityState!=='visible') return;
    const key=`${room.entry ?? 'general'}:${room.occ ?? ''}`;
    if(!unreadMap[key]) return; // nothing unread here → no write
    const t=setTimeout(()=>{ supabase!.rpc('hg_mark_read',{family:family.id,entry:room.entry,occ:room.occ}).then(r=>{ if(r.error){ console.warn('mark read failed', r.error.message); return; } setUnread(list=>list.filter(x=>!(x.family_id===family.id&&(x.entry_id ?? 'general')===(room.entry ?? 'general')&&(x.occurrence ?? '')===(room.occ ?? '')))); closeNotifications([`room-${room.entry ?? 'general'}`,'unread']); }); },600);
    return ()=>clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[family?.id,selected?.entry.id,selected?.date,tab,chatView,general.comments.length,general.attachments.length,detail.comments.length,detail.attachments.length,focusTick,unreadFamilyTotal]);
  // Opening a room counts as "seen" — no separate button to press.
  useEffect(()=>{ if(!selected||!family) return; const seen=data.receipts.some(r=>r.entry_id===selected.entry.id&&r.occurrence===selected.date&&r.user_id===uid&&r.state==='seen'); if(!seen) receipt('seen').catch(()=>undefined); // eslint-disable-line react-hooks/exhaustive-deps
  },[selected?.entry.id,selected?.date]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Messages live in paged rooms, not in the family snapshot, so sending only refreshes the room.
  async function sendComment(value: Record<string, unknown>) {
    if (demo) { setDemoRooms(d => ({ ...d, comments: [...d.comments, { id: crypto.randomUUID(), created_at: new Date().toISOString(), family_id: 'demo', entry_id: null, occurrence: null, created_by: uid, ...value } as DemoChat['comments'][number]] })); return; }
    const { error } = await supabase!.from('hg_comments').insert(value);
    if (error) throw error;
    bumpChat();
  }
  async function editComment(id: string, body: string) {
    if (demo) { setDemoRooms(d => ({ ...d, comments: d.comments.map(c => c.id === id ? { ...c, body, edited_at: new Date().toISOString() } : c) })); return; }
    const r = await supabase!.from('hg_comments').update({ body, edited_at: new Date().toISOString() }).eq('id', id).select('id');
    if (r.error) throw r.error;
    if (!r.data?.length) throw new Error('본인이 쓴 메시지만 수정할 수 있어요.');
    bumpChat();
  }
  async function deleteComment(id: string) {
    if (demo) { setDemoRooms(d => ({ ...d, comments: d.comments.filter(c => c.id !== id) })); return; }
    const r = await supabase!.from('hg_comments').delete().eq('id', id);
    if (r.error) throw r.error;
    bumpChat();
  }
  // Saving an expense teaches the family a rule: merchant keyword → category (and shared/personal). Demo keeps rules in memory.
  async function learnRule(title: string, category: string, scope: 'shared' | 'personal') {
    const keyword = learnKeyword(title); if (!keyword || !category) return;
    if (demo) { setData(d => ({ ...d, rules: [...d.rules.filter(r => r.keyword !== keyword), { id: crypto.randomUUID(), family_id: 'demo', keyword, category, scope }] })); return; }
    await supabase!.from('hg_category_rules').upsert({ family_id: family!.id, keyword, category, scope, created_by: uid }, { onConflict: 'family_id,keyword' });
  }
  async function envelopeEntry(envelope: Envelope, amount: number) {
    if (demo) { setData(d => ({ ...d, envelopeEntries: [...d.envelopeEntries, { id: crypto.randomUUID(), family_id: 'demo', envelope_id: envelope.id, amount, date: today(), created_by: uid }] })); return; }
    const r = await supabase!.from('hg_envelope_entries').insert({ family_id: family!.id, envelope_id: envelope.id, amount, date: today() }); if (r.error) throw r.error; await load();
  }
  async function deleteEnvelope(envelope: Envelope) {
    if (demo) { setData(d => ({ ...d, envelopes: d.envelopes.filter(e => e.id !== envelope.id), envelopeEntries: d.envelopeEntries.filter(e => e.envelope_id !== envelope.id) })); return; }
    const r = await supabase!.from('hg_envelopes').delete().eq('id', envelope.id); if (r.error) throw r.error; await load();
  }
  async function setSettled(monthKey: string, settled: boolean) {
    const monthDate = `${monthKey}-01`;
    if (demo) { setData(d => ({ ...d, settlements: settled ? [...d.settlements, { family_id: 'demo', month: monthDate, settled_at: new Date().toISOString(), settled_by: uid }] : d.settlements.filter(x => x.month.slice(0, 10) !== monthDate) })); return; }
    const r = settled ? await supabase!.from('hg_settlements').upsert({ family_id: family!.id, month: monthDate, settled_by: uid, settled_at: new Date().toISOString() }, { onConflict: 'family_id,month' }) : await supabase!.from('hg_settlements').delete().eq('family_id', family!.id).eq('month', monthDate);
    if (r.error) throw r.error; await load();
  }
  // A chat for one expense: reuse its linked room, or create a done-purchase entry on the spot and link the expense to it.
  async function openExpenseChat(e: Expense) {
    const existing = e.entry_id ? data.entries.find(x => x.id === e.entry_id) : null;
    if (existing) { setSelected({ entry: existing, date: e.occurrence || existing.date }); return; }
    const fields = { title: e.title, body: `${money(e.amount)} · ${e.category}${e.note ? ` · ${e.note}` : ''}`, kind: 'purchase' as const, date: e.date, repeat: 'none' as const, purchase_state: 'purchased' as const, expected_amount: Number(e.amount), assignee: null as unknown as string };
    if (demo) { const entry = { ...fields, id: crypto.randomUUID(), family_id: 'demo', created_by: uid } as Entry; setData(d => ({ ...d, entries: [...d.entries, entry], expenses: d.expenses.map(x => x.id === e.id ? { ...x, entry_id: entry.id, occurrence: e.date } : x) })); setSelected({ entry, date: e.date }); return; }
    const ins = await supabase!.from('hg_entries').insert({ family_id: family!.id, created_by: uid, ...fields }).select().single(); if (ins.error) throw ins.error;
    if (e.created_by === uid) await supabase!.from('hg_expenses').update({ entry_id: ins.data.id, occurrence: e.date }).eq('id', e.id);
    await load(); setSelected({ entry: ins.data as Entry, date: e.date });
  }
  // Rows the person confirmed from a screenshot. Same screenshot twice → the fingerprint index rejects the repeats and we just count them.
  async function importRows(rows: ImportRow[], cardId: string | null) {
    let added = 0, skipped = 0;
    for (const r of rows) {
      if (!r.merchant.trim() || !Number.isSafeInteger(r.amount) || r.amount === 0 || !r.date) { skipped++; continue; }
      const value = { title: r.merchant.trim().slice(0, 200), amount: r.amount, date: r.date, category: r.category, payment_method: cardId ? 'card' : 'other', card_id: cardId, source: 'ocr', reviewed: true, kind: 'expense', fingerprint: `ocr:${r.date}:${r.amount}:${r.merchant.replace(/\s+/g, '').slice(0, 30)}` };
      if (demo) { if (data.expenses.some(e => e.date === r.date && Number(e.amount) === r.amount && e.title === value.title)) { skipped++; continue; } setData(d => ({ ...d, expenses: [...d.expenses, { ...value, id: crypto.randomUUID(), family_id: 'demo', created_by: uid } as Expense] })); added++; continue; }
      const ins = await supabase!.from('hg_expenses').insert({ ...common(), ...value });
      if (ins.error) { if (ins.error.code === '23505') { skipped++; continue; } throw ins.error; }
      added++;
    }
    if (!demo) await load();
    setCaptureOpen(false); setCaptureFiles(null); setTab('money'); setFinanceView('list');
    setNotice(`캡처에서 ${added}건을 가계부에 넣었어요${skipped ? ` · ${skipped}건은 이미 있거나 비어 있어 건너뜀` : ''}.`);
  }
  async function aiRecognize(file: File): Promise<OcrRow[]> {
    if (demo || !supabase) throw new Error('AI 인식은 로그인 후 사용할 수 있어요.');
    const { data: { session } } = await supabase.auth.getSession();
    const form = new FormData(); form.append('image', file);
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/vision`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }, body: form });
    if (res.status === 503) throw new Error('AI 인식이 아직 켜져 있지 않아요. 관리자가 scripts/setup-vision-secret.sh 로 키를 넣으면 사용할 수 있어요.');
    if (!res.ok) throw new Error(`AI 인식 실패 (${res.status})`);
    const body = await res.json() as { rows?: OcrRow[] };
    return body.rows ?? [];
  }
  async function update(key: 'cards'|'expenses'|'entries'|'recurring', table: string, id: string, value: Record<string, unknown>) {
    if (demo) setData(d => ({...d, [key]: d[key].map(row => row.id === id ? {...row,...value} : row)}));
    else {
      const result = await supabase!.from(table).update(value).eq('id',id).select('id');
      if (result.error) throw result.error;
      if (!result.data?.length) throw new Error('수정 권한이 없거나 이미 삭제된 기록이에요. 새로고침 후 다시 확인해 주세요.');
      await load();
    }
  }
  // What already hangs off an entry decides whether its date may change and whether it may be deleted.
  async function entryLinks(id: string) {
    const local = { receipts: data.receipts.filter(r => r.entry_id === id && r.state !== 'seen').length, expenses: data.expenses.filter(e => e.entry_id === id).length }; // auto 'seen' marks never lock a date
    if (demo) return { ...local, comments: demoRooms.comments.filter(c => c.entry_id === id).length, shared: demoRooms.comments.filter(c => c.shared_entry_id === id).length, attachments: demoRooms.attachments.filter(f => f.entry_id === id).length };
    const [a, c, s] = await Promise.all([
      supabase!.from('hg_attachments').select('id', { count: 'exact', head: true }).eq('entry_id', id),
      supabase!.from('hg_comments').select('id', { count: 'exact', head: true }).eq('entry_id', id),
      supabase!.from('hg_comments').select('id', { count: 'exact', head: true }).eq('shared_entry_id', id),
    ]);
    for (const r of [a, c, s]) if (r.error) throw r.error;
    return { ...local, attachments: a.count ?? 0, comments: c.count ?? 0, shared: s.count ?? 0 };
  }
  function openEntryEdit(entry: Entry) {
    run(async () => {
      const links = await entryLinks(entry.id);
      setEntryLocked(Object.values(links).some(n => n > 0));
      setEditingEntry(entry); setSelected(null); setEntryDate(entry.date); setForm('entry');
    });
  }
  function switchSpace(id:string) {
    if(busy||id===family?.id)return;
    requestVersion.current++;setSelected(null);setForm(null);setInvite('');setNotice('');setError('');setData(emptyData);setFamily(null);setLoading(true);
    setActiveSpace(id);if(user)localStorage.setItem(`haraguri-space-${user.id}`,id);
  }
  function startDemo() {
    requestVersion.current++;
    setDemo(true); setData(demoData()); setDemoRooms(demoChat()); setFamily({ id: 'demo', name: '우리 가족', owner_id: 'demo', settings: { settlement: true } }); setSpaces([{id:'demo',name:'우리 가족',owner_id:'demo',settings:{settlement:true}}]); setError('');
  }
  async function requestEmailCode(email: string) {
    const r = await supabase!.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` } });
    if (r.error) throw new Error(/rate|frequency|seconds/i.test(r.error.message) ? '잠시 후 다시 시도해 주세요. 인증 메일은 1분에 한 번 보낼 수 있어요.' : '인증 메일을 보내지 못했어요. 이메일 주소를 확인해 주세요.');
    setEmailAddr(email); setNotice(`${email}로 인증 메일을 보냈어요. 링크를 누르거나 메일 속 번호를 입력하세요.`);
  }
  async function verifyEmailCode(token: string) {
    const r = await supabase!.auth.verifyOtp({ email: emailAddr, token: token.replace(/\D/g, ''), type: 'email' });
    if (r.error || !r.data.session) throw new Error('번호가 맞지 않거나 만료됐어요. 메일을 다시 확인하거나 새로 받아 주세요.');
  }
  const name = (id: string) => data.members.find(m => m.user_id === id)?.display_name ?? '가족';
  // Home board: the latest message and photo per room (one light query each; not the per-room pages the chat uses).
  const [roomActivity,setRoomActivity]=useState<{comments:Comment[];attachments:Attachment[]}>({comments:[],attachments:[]});
  useEffect(()=>{
    if(!family){ setRoomActivity({comments:[],attachments:[]}); return; }
    if(demo||!supabase){ setRoomActivity({comments:demoRooms.comments.filter(c=>!!c.entry_id),attachments:demoRooms.attachments.filter(a=>!!a.entry_id)}); return; }
    let active=true;
    Promise.all([
      supabase.from('hg_comments').select('*').eq('family_id',family.id).not('entry_id','is',null).order('created_at',{ascending:false}).limit(60),
      supabase.from('hg_attachments').select('*').eq('family_id',family.id).not('entry_id','is',null).order('created_at',{ascending:false}).limit(30),
    ]).then(([c,a])=>{ if(active) setRoomActivity({comments:(c.data as Comment[])??[],attachments:(a.data as Attachment[])??[]}); }).catch(()=>undefined);
    return ()=>{ active=false; };
  },[family?.id,demo,demoRooms,chatVersion]);
  const roomSummaries=useMemo(()=>{
    const m:Record<string,RoomSummary>={};
    for(const c of roomActivity.comments){ const k=`${c.entry_id}:${c.occurrence}`; if(!m[k]||(m[k].at??'')<c.created_at) m[k]={...m[k],text:c.body,by:name(c.created_by),at:c.created_at}; }
    for(const a of roomActivity.attachments){ if(!/\.(png|jpe?g|webp)$/i.test(a.path)) continue; const k=`${a.entry_id}:${a.occurrence}`; const cur=m[k]||{}; if(!cur.photo) m[k]={...cur,photo:a.path,at:cur.at&&cur.at>(a.created_at||'')?cur.at:(a.created_at||cur.at)}; }
    return m;
  },[roomActivity,data.members]); // eslint-disable-line react-hooks/exhaustive-deps
  const homePhotos=useSignedPhotos(roomActivity.attachments.filter(a=>/\.(png|jpe?g|webp)$/i.test(a.path)));
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
  // `target` undefined → the room currently open in the detail dialog; null → the family's general chat.
  async function upload(originals: File[], target?: Room) {
    const room: Room = target === undefined ? selected : target;
    if (demo) throw new Error('미리보기에서는 파일을 저장하지 않습니다. 로그인 후 이용해 주세요.');
    if (room && isClosed(data.rooms, room)) throw new Error('종료된 대화예요. 다시 열면 올릴 수 있어요.');
    if (usage && usage.limit && usage.bytes >= usage.limit) throw new Error(`가족 저장공간 ${formatBytes(usage.limit)}을 다 썼어요. 끝난 대화를 종료해 사진을 정리한 뒤 다시 올려 주세요.`);
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf','text/plain','audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/x-m4a','audio/aac','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    const bucket = supabase!.storage.from('haraguri-files');
    let done = 0;
    try {
      for (const original of originals) {
        if (!allowed.includes(original.type)) throw new Error(`${original.name}: JPG, PNG, WEBP, PDF, TXT, DOCX, XLSX 파일(또는 음성 메시지)을 올려주세요.`);
        const { file, thumb } = await prepareUpload(original);
        if (file.size > 10 * 1024 * 1024) throw new Error(`${original.name}: 파일은 10MB 이하로 올려주세요.`);
        const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'bin';
        const path = `${family!.id}/${uid}/${crypto.randomUUID()}.${extension}`;
        const uploaded = await bucket.upload(path, file, { contentType: file.type });
        if (uploaded.error) throw uploaded.error;
        // The thumbnail is best-effort: the chat falls back to the full photo when it is missing.
        const thumbOk = thumb ? !(await bucket.upload(thumbPath(path), thumb, { contentType: 'image/jpeg' })).error : false;
        const size = file.size + (thumbOk && thumb ? thumb.size : 0);
        const r = await supabase!.from('hg_attachments').insert({ family_id: family!.id, entry_id: room?.entry.id ?? null, occurrence: room?.date ?? null, path, name: file.name, size, created_by: uid });
        if (r.error) { await bucket.remove(thumbOk ? [path, thumbPath(path)] : [path]); throw r.error; }
        done++;
      }
    } finally { if (done) bumpChat(); }
    if (originals.length > 1) setNotice(`사진·문서 ${done}개를 올렸어요.`);
  }
  const [dismissedFinish, setDismissedFinish] = useState<Set<string>>(new Set());
  // Closing a room: writes stop, every file in it is removed (storage + rows), the text stays.
  async function closeRoom(room: Exclude<Room, null>) {
    const key = `${room.entry.id}|${room.date}`;
    if (demo) {
      const files = demoRooms.attachments.filter(f => inRoom(f, room));
      if (!window.confirm(`대화를 종료할까요? 사진·문서 ${files.length}개는 지워지고 글은 남아요.`)) return;
      setDemoRooms(d => ({ ...d, attachments: d.attachments.filter(f => !inRoom(f, room)) }));
      setData(d => ({ ...d, rooms: [...d.rooms.filter(r => !(r.entry_id === room.entry.id && r.occurrence === room.date)), { family_id: 'demo', entry_id: room.entry.id, occurrence: room.date, closed_at: new Date().toISOString(), closed_by: uid, purged_at: new Date().toISOString(), purged_files: files.length, purged_bytes: files.reduce((s, f) => s + (f.size ?? 0), 0) }] }));
      setNotice('대화를 종료했어요.'); return;
    }
    const files = await listRoomFiles(family!.id, room);
    const bytes = files.reduce((s, f) => s + Number(f.size ?? 0), 0);
    const warning = files.length ? `사진·문서 ${files.length}개(${formatBytes(bytes)})를 지우고 대화를 종료할까요? 글은 남아요. 남길 사진이 있으면 먼저 내려받으세요.` : '대화를 종료할까요? 글은 남고, 다시 열 수 있어요.';
    if (!window.confirm(warning)) return;
    const bucket = supabase!.storage.from('haraguri-files');
    for (let i = 0; i < files.length; i += 50) {
      const batch = files.slice(i, i + 50);
      const removed = await bucket.remove(batch.flatMap(f => [f.path, thumbPath(f.path)]));
      if (removed.error) throw new Error(`파일을 지우지 못했어요: ${removed.error.message}`);
      const deleted = await supabase!.from('hg_attachments').delete().in('id', batch.map(f => f.id));
      if (deleted.error) throw deleted.error;
    }
    const now = new Date().toISOString();
    const saved = await supabase!.from('hg_rooms').upsert({ family_id: family!.id, entry_id: room.entry.id, occurrence: room.date, closed_at: now, closed_by: uid, purged_at: files.length ? now : null, purged_files: files.length, purged_bytes: bytes }, { onConflict: 'entry_id,occurrence' });
    if (saved.error) throw saved.error;
    setDismissedFinish(d => { const next = new Set(d); next.delete(key); return next; });
    bumpChat(); await load();
    setNotice(files.length ? `대화를 종료하고 ${formatBytes(bytes)}를 정리했어요.` : '대화를 종료했어요.');
  }
  async function reopenRoom(room: Exclude<Room, null>) {
    if (demo) { setData(d => ({ ...d, rooms: d.rooms.map(r => r.entry_id === room.entry.id && r.occurrence === room.date ? { ...r, closed_at: null, closed_by: null } : r) })); return; }
    const r = await supabase!.from('hg_rooms').update({ closed_at: null, closed_by: null }).eq('entry_id', room.entry.id).eq('occurrence', room.date).select('entry_id');
    if (r.error) throw r.error;
    if (!r.data?.length) throw new Error('대화 상태를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.');
    bumpChat(); await load();
    setNotice('대화를 다시 열었어요. 지웠던 사진은 돌아오지 않아요.');
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
        const expected = Number(str('expected_amount') || 0);
        if (!Number.isSafeInteger(expected) || expected < 0 || expected > 1000000000) throw new Error('예상 금액을 올바른 원 단위로 입력해 주세요.');
        const fields = { title: str('title'), body: str('body'), kind: str('kind'), assignee: str('assignee') || null, expected_amount: expected };
        const schedule = { date: str('date'), repeat: str('kind') === 'purchase' ? 'none' : str('repeat') || 'none' };
        if (editingEntry) await update('entries', 'hg_entries', editingEntry.id, entryLocked ? fields : { ...fields, ...schedule });
        else await insert('entries', 'hg_entries', { ...common, ...fields, ...schedule });
      } else if (form === 'expense') {
        const amount = Number(str('amount'));
        const kind = str('kind') === 'transfer' ? 'transfer' : str('kind') === 'income' ? 'income' : 'expense';
        if (!str('title') || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1000000000) throw new Error('사용처와 올바른 원 단위 금액을 입력해 주세요.');
        if (kind !== 'expense' && amount <= 0) throw new Error('수입은 0보다 큰 금액으로 입력해 주세요.');
        const qualifying = str('card_id') && str('perf_exclude') === 'on' ? 0 : null; // one switch: counts toward card performance or not
        validateQualifyingAmount(amount, qualifying);
        if (str('payment_method')==='card' && !str('card_id')) throw new Error('카드를 선택해 주세요.');
        const entry=data.entries.find(e=>e.id===str('entry_id'));
        if(entry && occurrence(entry,str('occurrence').slice(0,7))!==str('occurrence')) throw new Error('반복 일정의 실제 회차 날짜를 선택해 주세요.');
        const scopeValue = str('scope') === 'personal' ? 'personal' : 'shared';
        const value = {entry_id: entry?.id || null, occurrence: entry?str('occurrence'):null, payment_method: str('payment_method'), title: str('title'), amount, date: str('date'), category: str('category'), card_id: str('card_id') || null, qualifying_amount: qualifying, performance_month: null, kind, note: str('note').slice(0, 200), scope: scopeValue, regret: kind === 'expense' && str('regret') === 'on'};
        if (kind !== 'expense') { value.card_id = null; value.qualifying_amount = null; value.performance_month = null; if (value.payment_method === 'card' || !value.payment_method) value.payment_method = 'bank_transfer'; }
        if (kind === 'transfer') { value.payment_method = 'bank_transfer'; value.category = '자금 이동'; value.scope = 'personal'; value.entry_id = null; value.occurrence = null; }
        if (editingExpense) await update('expenses','hg_expenses',editingExpense.id,editingExpense.reviewed===false?{...value,reviewed:true}:value);
        else { await insert('expenses','hg_expenses',{...common,...value}); try{localStorage.setItem(lastPayKey,JSON.stringify({payment_method:value.payment_method,card_id:value.card_id||''}));}catch{} }
        if (kind === 'expense') await learnRule(value.title, value.category, scopeValue);
      } else if (form === 'envelope') {
        const target = Number(str('env_target'));
        if (!str('env_name') || !Number.isSafeInteger(target) || target <= 0) throw new Error('이름과 목표 금액을 입력해 주세요.');
        const row = { family_id: family!.id, name: str('env_name').slice(0, 60), target, due_month: str('env_due') ? `${str('env_due')}-01` : null };
        if (demo) setData(d => ({ ...d, envelopes: [...d.envelopes, { ...row, id: crypto.randomUUID(), created_by: uid }] }));
        else { const r = await supabase!.from('hg_envelopes').insert(row); if (r.error) throw r.error; await load(); }
      } else if (form === 'budget') {
        const totalBudget = Number(str('budget_total') || 0);
        if (!Number.isSafeInteger(totalBudget) || totalBudget < 0 || totalBudget > 100000000000) throw new Error('예산은 0 이상의 원 단위 금액으로 입력해 주세요.');
        const by_category: Record<string, number> = {};
        for (const c of categories) { const v = Number(str(`budget_${c}`) || 0); if (Number.isSafeInteger(v) && v > 0) by_category[c] = v; }
        const row = { family_id: family!.id, month: `${month}-01`, total: totalBudget, by_category };
        if (demo) setData(d => ({ ...d, budgets: [...d.budgets.filter(b => b.month.slice(0, 10) !== row.month), row] }));
        else { const r = await supabase!.from('hg_budgets').upsert({ ...row, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: 'family_id,month' }); if (r.error) throw r.error; await load(); }
      } else if (form === 'recurring') {
        const amount = Number(str('amount')); const day = Number(str('day_of_month'));
        if (!str('title') || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000) throw new Error('이름과 올바른 원 단위 금액을 입력해 주세요.');
        if (!Number.isSafeInteger(day) || day < 1 || day > 31) throw new Error('날짜는 1~31 사이로 입력해 주세요.');
        if (str('payment_method') === 'card' && !str('card_id')) throw new Error('카드를 선택해 주세요.');
        await insert('recurring','hg_recurring_expenses',{ family_id: family!.id, created_by: uid, title: str('title'), amount, day_of_month: day, category: str('category'), payment_method: str('payment_method'), card_id: str('payment_method') === 'card' ? str('card_id') : null, start_month: `${str('start_month')}-01`, end_month: str('end_month') ? `${str('end_month')}-01` : null, active: true });
      } else {
        const budget = Number(str('budget'));
        const creditLimit = Number(str('credit_limit'));
        if (!Number.isSafeInteger(creditLimit) || creditLimit < 0 || creditLimit > 1000000000) throw new Error('카드 한도를 올바른 원 단위 금액으로 입력해 주세요.');
        if (!str('name') || !Number.isSafeInteger(budget) || budget < 0 || budget > 1000000000) throw new Error('카드 이름과 올바른 월 예산을 입력해 주세요.');
        const value = {card_type: str('card_type'), name: str('name'), holder: str('holder'), budget, credit_limit: creditLimit, owner_user_id: str('owner_user_id') || null, performance_thresholds: parseThresholds(str('performance_thresholds')), benefit_basis: str('benefit_basis'), excluded_categories: values.getAll('excluded_categories').map(String), benefit_note: str('benefit_note'), perf_override_month: str('perf_override_month') ? `${str('perf_override_month')}-01` : null, perf_override_amount: str('perf_override_amount') ? Number(str('perf_override_amount')) : null, perf_override_date: str('perf_override_date') || null};
        if (value.perf_override_amount != null && (!Number.isSafeInteger(value.perf_override_amount) || value.perf_override_amount < 0 || !value.perf_override_month)) throw new Error('카드사 실적 보정은 기준 월과 0 이상의 금액을 함께 입력해 주세요.');
        if (editingCard) await update('cards','hg_cards',editingCard.id,value);
        else await insert('cards','hg_cards',{family_id: family!.id,...value});
      }
      setForm(null); setEditingEntry(null); if(form==='expense'&&expenseRoom)setSelected(expenseRoom); setNotice(demo ? '미리보기에 반영했어요. 새로고침하면 초기화됩니다.' : '저장했어요.');
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
  const inviteCards = invites.map(i => <div className="invite-card" key={i.family_id}><div><strong>{i.family_name}</strong><small>{i.invited_by_name}님이 ‘{i.matched}’(으)로 초대했어요</small></div><button className="primary" disabled={busy} onClick={() => run(() => acceptInvite(i))}>참여하기</button></div>);

  if (!authReady) return <main className="auth"><div className="brand">HARAGURI<span>우리 가족의 하루</span></div><p>가족 공간을 준비하고 있어요…</p></main>;
  if (!demo && !user) return <main className="auth"><div className="brand">HARAGURI<span>우리 가족의 하루</span></div><section className="auth-card">
    <div className="eyebrow">A LITTLE CLOSER, EVERY DAY</div>{pendingInvite&&<div className="banner invite-banner">초대받으셨네요! 로그인하면 모임에 바로 참여돼요.</div>}<h1>함께 챙기는 일상,<br/>차곡차곡 쌓이는 우리.</h1><p>이번 달 할 일부터 오늘 쓴 생활비까지.<br/>가족에게 필요한 이야기를 한곳에 모아요.</p>{banners}
    {supabase ? <>
      {!emailMode && <><button className="kakao-button" disabled={busy} onClick={()=>run(()=>startKakaoLogin())}><KakaoGlyph/>{busy?'카카오로 연결 중…':'카카오 로그인'}</button><p className="login-note">이메일 입력 없이 카카오 계정으로 시작해요.<br/>처음이라면 로그인 후 모임을 만들거나, 가족이 보낸 초대 링크로 참여하세요.<br/>가족이 내 카카오 닉네임을 등록해 뒀다면 로그인만 하면 돼요.</p>
      {!pendingInvite&&(codeMode
        ? <form className="email-login" onSubmit={e=>{e.preventDefault();rememberInvite(String(new FormData(e.currentTarget).get('code')||''));}}><label>초대 코드 또는 링크<input name="code" required autoComplete="off" placeholder="가족이 보낸 코드·링크를 붙여넣으세요"/></label><button className="secondary">코드 기억하기</button><button type="button" className="text-button" onClick={()=>setCodeMode(false)}>취소</button></form>
        : <button className="text-button" onClick={()=>{setCodeMode(true);setError('');}}>초대 코드를 받았어요</button>)}
      <button className="text-button" onClick={()=>{setEmailMode(true);setError('');setNotice('');}}>카카오가 안 될 때 · 이메일로 로그인</button></>}
      {emailMode && (emailAddr
        ? <form className="email-login" onSubmit={e=>{e.preventDefault();const v=new FormData(e.currentTarget);run(()=>verifyEmailCode(String(v.get('token'))));}}>
            <p className="login-note"><b>{emailAddr}</b>로 메일을 보냈어요. <b>지금 이 기기·브라우저에서</b> 메일의 링크를 누르면 바로 로그인돼요. 메일에 8자리 번호가 있으면 아래에 입력해도 돼요.</p>
            <label>인증번호 (메일에 번호가 있을 때만)<input name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,10}" required placeholder="메일 속 8자리 번호"/></label>
            <button className="primary" disabled={busy}>로그인</button>
            <div className="email-login-links"><button type="button" className="text-button" disabled={busy} onClick={()=>run(()=>requestEmailCode(emailAddr))}>메일 다시 받기</button><button type="button" className="text-button" onClick={()=>{setEmailAddr('');setNotice('');}}>다른 이메일</button></div>
          </form>
        : <form className="email-login" onSubmit={e=>{e.preventDefault();const v=new FormData(e.currentTarget);run(()=>requestEmailCode(String(v.get('email')).trim()));}}>
            <label>이메일<input type="email" name="email" required autoComplete="email" placeholder="you@example.com"/></label>
            <button className="primary" disabled={busy}>인증 메일 받기</button>
            <p className="login-note">카카오를 쓸 수 없을 때를 위한 로그인이에요. 메일이 오지 않으면 스팸함을 확인해 주세요.</p>
            <button type="button" className="text-button" onClick={()=>setEmailMode(false)}>← 카카오 로그인으로</button>
          </form>)}
    </> : <p className="setup-note">아직 로그인 연결 설정이 준비되지 않았어요. 먼저 미리보기로 둘러보세요.</p>}
    <button className="secondary" onClick={startDemo}>로그인 없이 미리보기 ↗</button><small>미리보기의 기록은 저장되지 않습니다.</small>
  </section></main>;

  if (!family) return <main className="auth"><div className="brand">HARAGURI<span>우리 가족의 하루</span></div><section className="auth-card"><h1>{invites.length ? '초대받은 모임이 있어요!' : '우리 가족을 모아볼까요?'}</h1>{banners}{invites.length > 0 && <div className="invite-list"><h2 className="list-title">초대받은 모임</h2>{inviteCards}<div className="divider">또는 직접 만들기 · 코드로 참여</div></div>}{loading ? <p>가족 정보를 확인하고 있어요…</p> : <form onSubmit={e => { e.preventDefault(); const v = new FormData(e.currentTarget); const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement; run(async () => {
      const memberName = String(v.get('display_name')).trim();
      const r = button.value === 'join' ? await supabase!.rpc('hg_join_family', { invite_code: String(v.get('invite')||'').match(/[0-9a-f-]{36}/i)?.[0] ?? '', member_name: memberName }) : await supabase!.rpc('hg_create_family', { family_name: v.get('family_name'), member_name: memberName });
      if (r.error) throw r.error; setActiveSpace(r.data); localStorage.setItem(`haraguri-space-${uid}`,r.data); await load();
    }); }}><label>가족에게 보여줄 이름<input name="display_name" required maxLength={40} defaultValue={user?.user_metadata?.name || user?.user_metadata?.nickname || ''} placeholder="이름 또는 애칭"/></label><label>새 가족 공간 이름<input name="family_name" defaultValue="우리 가족" maxLength={80}/></label><button className="primary" value="create" disabled={busy}>가족 공간 만들기</button><div className="divider">또는 초대받으셨나요?</div><label>초대 링크 또는 코드<input name="invite" placeholder="가족에게 받은 링크나 코드를 붙여넣으세요"/></label><button className="secondary" value="join" disabled={busy}>초대 링크·코드로 참여하기</button></form>}<button className="text-button" onClick={() => run(async () => { const r = await supabase!.auth.signOut(); if (r.error) throw r.error; })}>로그아웃</button></section></main>;

  const chatFull = tab==='chat' && chatView==='general' && !selected; // mobile: the general chat takes the whole screen, like a messenger
  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="/">HARAGURI<span>우리 가족의 하루</span></a><div className="family-label">{family.name}<span>{data.members.length}명이 함께해요</span></div><nav aria-label="주 메뉴">{tabs.map(([key, icon, title]) => <button key={key} aria-label={title} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span>{icon}</span>{title}{key==='chat'&&unreadFamilyTotal>0&&<b aria-label={`안 읽은 메시지 ${unreadFamilyTotal}개`}>{unreadFamilyTotal}</b>}</button>)}<button aria-label="설정" aria-current={tab==='settings'?'page':undefined} className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><span>⚙</span>설정</button></nav><div className="sidebar-note">작은 일도 함께 나누면<br/>조금 더 가벼워지니까.</div><div className="profile"><span className="avatar" style={{ background: memberColor(data.members, uid).bg, color: memberColor(data.members, uid).fg }}>{name(uid).slice(0, 1)}</span><div>{name(uid)}<small>오늘도 반가워요</small></div></div></aside>
    <main className={`main ${chatFull?'chat-full':''}`}>
      <header className="topbar"><span className="mobile-brand">HARAGURI</span><button className="text-button" aria-label={`알림 ${unseen.length || ''} 확인`} onClick={()=>{setTab('home');window.setTimeout(()=>document.getElementById('due-section')?.scrollIntoView({behavior:'smooth',block:'start'}),60);}}>알림 {unseen.length || ''}</button><span className="date-label">{new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</span><button type="button" className="icon-settings" aria-label="설정" aria-current={tab==='settings'?'page':undefined} onClick={()=>setTab('settings')}>⚙</button><div className="avatars">{data.members.map(m => { const c = memberColor(data.members, m.user_id); return <span className="avatar" style={{ background: c.bg, color: c.fg }} title={m.display_name} key={m.user_id}>{m.display_name.slice(0, 1)}</span>; })}</div></header>
      {spaces.length>1&&<div className="space-switcher"><label>현재 모임<select aria-label="현재 모임" value={family.id} disabled={busy||demo} onChange={e=>switchSpace(e.target.value)}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="text-button" onClick={()=>setTab('settings')}>＋ 모임 만들기·참여</button></div>}
      {demo && <div className="demo-banner">미리보기 · 입력한 내용은 새로고침하면 초기화됩니다.<button onClick={() => { setDemo(false); setFamily(null); setData(emptyData); setDemoRooms({comments:[],attachments:[]}); setSelected(null); setForm(null); }}>로그인하기 ↗</button></div>}
      {banners}
      {invites.map(i => <div role="status" className="banner invite-banner" key={i.family_id}>📨 {i.invited_by_name}님이 ‘{i.family_name}’ 모임에 초대했어요.<button disabled={busy} onClick={() => run(() => acceptInvite(i))}>참여하기 →</button></div>)}
      {truncated.length > 0 && <div role="status" className="banner">기록이 많아 {truncated.map(k => tableLabel[k]).join('·')}은(는) 최근 {ROW_CAP.toLocaleString('ko-KR')}건까지만 표시해요. 합계는 표시된 범위 기준이에요.</div>}
      <div className={`page-heading ${tab==="home"?"":"compact"}`}><div><div className="eyebrow">OUR LITTLE FAMILY SPACE</div><h1>{tab === 'home' ? '우리의 하루를 함께.' : tabs.find(t => t[0] === tab)?.[2] ?? '설정'}</h1><p>{tab === 'home' ? '챙겨야 할 일도, 기억하고 싶은 순간도 여기에.' : tab === 'money' ? '오늘의 지출을 기록하고, 이번 달 생활비를 함께 살펴봐요.' : tab === 'calendar' ? '매달 돌아오는 할 일과 소중한 약속을 놓치지 않게.' : tab === 'chat' ? '가족 기본 채팅과 일정·구매별 대화를 함께 살펴봐요.' : '가족을 초대하고 함께 쓰는 공간을 관리해요.'}</p></div>{(tab === 'home' || tab === 'calendar') && <button className="primary" onClick={() => {setEntryDate('');setForm('entry');}}>＋ 일정·할 일</button>}{tab === 'money' && <button className="primary" onClick={() => openExpense()}>＋ 지출 기록</button>}</div>
      {loading && <p role="status" className="muted">최신 기록을 불러오는 중…</p>}
      {tab === 'home' && <>
        <div className="week-strip" role="group" aria-label="이번 주">{weekOf(today()).map(d=>{const items=monthEntries(data.entries,d.slice(0,7)).filter(r=>r.date===d);const overdue=d<today()&&items.some(r=>!done(r.entry.id,r.date));const holiday=holidayName(d);return <button key={d} className={`${dayTone(d)} ${d===today()?'today':''} ${overdue?'has-overdue':''}`} aria-label={`${d} ${holiday?holiday.slice(0,3):['일','월','화','수','목','금','토'][new Date(`${d}T12:00:00`).getDay()]}${Number(d.slice(8))} 일정 ${items.length}개`} title={holiday||undefined} onClick={()=>{setPlannerFocus(d);setTab('calendar');}}><small>{holiday?holiday.slice(0,3):['일','월','화','수','목','금','토'][new Date(`${d}T12:00:00`).getDay()]}</small><strong>{Number(d.slice(8))}</strong><span className="year-dots">{[...new Set(items.map(r=>r.entry.kind))].map(k=><i key={k} className={k}/>)}</span></button>;})}</div>
        {(()=>{const b=budgetStatus(data.budgets,data.expenses,today().slice(0,7),today());return <section className={`today-line ${b.total>0&&b.percent>=80?'warn':''}`} aria-label="오늘 한눈에"><button type="button" onClick={()=>document.getElementById('due-section')?.scrollIntoView({behavior:'smooth',block:'start'})}><span>오늘 챙길 일</span><b>{due.length}개</b></button><button type="button" onClick={()=>setTab('money')}><span>오늘 쓴 돈</span><b>{money(total(data.expenses,today()))}</b></button><button type="button" onClick={()=>{setError('');setMonth(today().slice(0,7));setForm('budget');}}><span>{b.total>0?`남은 예산 · ${b.percent}% 사용`:'예산'}</span><b>{b.total>0?(b.remaining>=0?`${money(b.remaining)} · 오늘 ${money(b.perDay)}까지`:`${money(-b.remaining)} 초과`):'정하기 →'}</b></button>{b.total>0&&<progress value={Math.min(100,b.percent)} max={100} className={b.percent>=80?'warn':''} aria-label="예산 사용률"/>}</section>;})()}
        {!demo&&<AutoCollectBanner state={collect} onOpen={()=>{setCollectOpen(true);setTab('money');}}/>}
        <WorkBoard title={family.name.includes('가족')?'우리집 일':'모임의 일'} data={data} unread={unreadMap} summaries={roomSummaries} photos={homePhotos} month={today().slice(0,7)} compact onMore={()=>{setTab('chat');setChatView('work');}} onOpen={(entry,date)=>setSelected({entry,date})} onCreate={()=>{setEntryDate('');setForm('entry');}}/>
        <div className="home-grid"><section className="panel" id="due-section"><div className="section-head"><h2>놓치지 말고 챙겨요 <span className="count">{due.length}</span></h2><button className="text-button" onClick={() => setTab('calendar')}>전체 보기 ↗</button></div>{due.length ? due.slice(0, 5).map(({ entry, date }) => renderEntry(entry, date)) : <div className="empty">오늘까지 할 일을 모두 챙겼어요 🌿</div>}<div className="gentle-note">확인과 완료는 따로 기록해요.<br/>반복되는 할 일도 매달 새롭게 체크할 수 있어요.</div></section>
        <section className="panel"><div className="section-head"><h2>최근 지출</h2><button className="text-button" onClick={() => setTab('money')}>가계부 ↗</button></div>{data.expenses.filter(e=>e.kind!=='income'&&e.kind!=='transfer').sort((a,b) => b.date.localeCompare(a.date)).slice(0,4).map(e => <div className="expense-row" key={e.id}><span className="expense-icon">₩</span><div><strong>{e.title}</strong><small>{e.date.slice(5)} · {e.category}</small></div><b>{money(e.amount)}</b></div>)}{!data.expenses.length && <div className="empty">첫 생활비를 기록해 보세요.</div>}<button className="wide-button" onClick={() => openExpense()}>＋ 지출 기록하기</button></section></div>
        <section className="panel"><div className="section-head"><h2>이번 달 함께할 순간</h2><span className="muted">{today().slice(0,7).replace('-', '. ')}</span></div>{currentRows.filter(r => r.date >= today()).slice(0,4).map(({ entry, date }) => renderEntry(entry, date))}{!currentRows.some(r => r.date >= today()) && <div className="empty">가족과 함께할 다음 일정을 등록해 보세요.</div>}</section>
      </>}
      {tab === 'calendar' && <Planner data={data} month={month} setMonth={setMonth} focusDay={plannerFocus} onOpen={(entry,date)=>setSelected({entry,date})} onCreate={date=>{setEntryDate(date);setForm('entry');}}/>}
      {tab === 'money' && !demo && <AutoCollectStatus state={collect} open={collectOpen} onToggle={()=>setCollectOpen(o=>!o)}/>}
      {tab === 'money' && !demo && collectOpen && <AutoCollectCard state={collect} busy={busy} run={run} onClose={()=>setCollectOpen(false)}/>}
      {tab === 'money' && <FinancePanel entries={data.entries} onOpenWork={(entry,date)=>setSelected({entry,date})} cards={data.cards} expenses={data.expenses} uid={uid} month={month} setMonth={setMonth} busy={busy} onAddCard={()=>openCard()} onEditCard={openCard} onEditExpense={openExpense}
        view={financeView} setView={setFinanceView} report={monthlyReport(data.expenses,data.members,month,today())} recurring={data.recurring}
        onAddRecurring={()=>{setRecurringPrefill(null);setError('');setForm('recurring');}}
        onToggleRecurring={r=>run(()=>update('recurring','hg_recurring_expenses',r.id,{active:!r.active}))}
        onDeleteRecurring={r=>{if(!window.confirm(`'${r.title}' 반복 지출을 삭제할까요? 이미 기록된 지출은 남아요.`))return;run(async()=>{if(demo)setData(d=>({...d,recurring:d.recurring.filter(x=>x.id!==r.id)}));else{const d=await supabase!.from('hg_recurring_expenses').delete().eq('id',r.id);if(d.error)throw d.error;await load();}});}}
        onConfirmReview={e=>run(async()=>{await update('expenses','hg_expenses',e.id,{reviewed:true}); if((e.kind??'expense')==='expense') await learnRule(e.title,e.category,e.scope||'shared');})}
        budgets={data.budgets} onEditBudget={()=>{setError('');setForm('budget');}} members={data.members} envelopes={data.envelopes} envelopeEntries={data.envelopeEntries} settlements={data.settlements}
        onAddEnvelope={()=>{setError('');setForm('envelope');}} onEnvelopeEntry={(e,amount)=>run(()=>envelopeEntry(e,amount))} onDeleteEnvelope={e=>run(()=>deleteEnvelope(e))} onMarkSettled={m=>run(()=>setSettled(m,true))} onUnsettle={m=>run(()=>setSettled(m,false))}
        onCapture={()=>{setError('');setForm(null);setCaptureOpen(true);}} settlementOn={!!family.settings?.settlement}
        onToggleRegret={e=>run(()=>update('expenses','hg_expenses',e.id,{regret:!e.regret}))} onOpenChat={e=>run(()=>openExpenseChat(e))} onAddRecurringFrom={c=>{setRecurringPrefill(c);setError('');setForm('recurring');}}
        onDeleteExpense={expense=>{
        if(!window.confirm('이 지출 기록을 삭제할까요?')) return;
        run(async()=>{if(demo) setData(d=>({...d,expenses:d.expenses.filter(e=>e.id!==expense.id)})); else {const r=await supabase!.from('hg_expenses').delete().eq('id',expense.id);if(r.error)throw r.error;await load();}});
      }}/>}
      {tab === 'chat' && <>
        {!demo&&push==='off'&&<div role="status" className="banner push-nudge">🔔 가족이 메시지를 남기면 이 기기로 알림을 받아보세요.<button disabled={busy} onClick={()=>run(async()=>{await enablePush(user!.id);await refreshPush();setNotice('푸시 알림을 켰어요. 가족이 메시지를 남기면 이 기기로 와요.');})}>알림 켜기</button></div>}
        {!demo&&push==='needs-install'&&<div role="status" className="banner">🔔 iPhone은 Safari 공유 → ‘홈 화면에 추가’로 설치한 앱에서 채팅 알림을 켤 수 있어요.</div>}
        {!demo&&push==='on'&&<p className="muted push-state">🔔 이 기기 알림 켜짐 · 내가 보낸 메시지는 나한테 안 와요 · <button className="text-button inline" onClick={()=>setTab('settings')}>종류·조용한 시간 바꾸기</button></p>}
        <div className="payment-tabs" role="group" aria-label="대화 종류"><button aria-pressed={chatView==='general'} onClick={()=>setChatView('general')}>가족 기본 채팅{unreadGeneral>0&&<b className="tab-badge">{unreadGeneral}</b>}</button><button aria-pressed={chatView==='work'} onClick={()=>setChatView('work')}>일정·구매별 대화{unreadFamilyTotal-unreadGeneral>0&&<b className="tab-badge">{unreadFamilyTotal-unreadGeneral}</b>}</button></div>
        {chatView==='work'?<WorkBoard title={family.name.includes('가족')?'우리집 일':'모임의 일'} data={data} unread={unreadMap} month={month} onOpen={(entry,date)=>setSelected({entry,date})} onCreate={()=>{setEntryDate('');setForm('entry');}}/>:!selected&&<div className="panel"><Chat key={`general-${family.id}`} room={null} unreadCount={unreadGeneral} comments={general.comments} attachments={general.attachments} hasMore={general.hasMore} loadingOlder={general.loading} loadError={general.error} onOlder={general.loadOlder} entries={data.entries} uid={uid} name={name} busy={busy} sync={sync} onOpen={(entry,date)=>setSelected({entry,date})} onSend={(body,replyTo)=>run(()=>sendComment({family_id:family.id,entry_id:null,occurrence:null,body,created_by:uid,reply_to:replyTo??null}))} {...socialFor(null,generalSocialLive)} othersCount={Math.max(0,data.members.length-1)} onReact={(id,e)=>run(()=>react(id,e))} onPin={id=>run(()=>pinMessage(null,id))} onUnpin={()=>run(()=>unpin(null))} onPhotoUrl={photoUrl} onSearch={searchMessages} onJump={jumpToHit} highlightId={highlightId} onEdit={(id,body)=>run(()=>editComment(id,body))} onDelete={id=>run(()=>deleteComment(id))} onUpload={files=>run(()=>upload(files,null))} onFile={file=>run(()=>openFile(file))}/></div>}
      </>}
      {tab === 'settings' && <section className="panel settings"><h2>모임 공간</h2><p>가족·친구·행사별로 독립된 공간을 만들어요. 대화, 일정, 카드와 지출은 선택한 모임 멤버끼리만 공유합니다.</p>
        {invites.length > 0 && <><h2 className="list-title">초대받은 모임</h2>{inviteCards}</>}
        <h3>새 모임 만들기</h3>
        <form key={spaceAction} onSubmit={e=>{e.preventDefault();const v=new FormData(e.currentTarget);run(async()=>{
          if(demo)throw new Error('실제 모임 생성·참여는 로그인 후 이용해 주세요.');
          const r=spaceAction==='create'?await supabase!.rpc('hg_create_family',{family_name:v.get('space_name'),member_name:v.get('member_name')}):await supabase!.rpc('hg_join_family',{invite_code:v.get('space_invite'),member_name:v.get('member_name')});
          if(r.error)throw r.error;
          requestVersion.current++;setSelected(null);setInvite('');setData(emptyData);setFamily(null);setLoading(true);setActiveSpace(r.data);localStorage.setItem(`haraguri-space-${uid}`,r.data);setTab('home');
        });}}><label>이 모임에서 사용할 이름<input name="member_name" required maxLength={40} defaultValue={name(uid)}/></label>{spaceAction==='create'?<label>모임 이름<input name="space_name" required maxLength={80} placeholder="우리 가족 / 부모님 생신 / 친구 여행"/></label>:<label>모임 초대 코드<input name="space_invite" required placeholder="초대 코드를 붙여넣으세요"/></label>}<button className="primary" disabled={busy}>{spaceAction==='create'?'모임 생성하기':'모임 참여하기'}</button></form>
        <h2 className="list-title">{family.name}{family.owner_id===uid&&<button className="text-button" disabled={busy} onClick={()=>{const name=window.prompt('모임 이름을 입력하세요',family.name)?.trim();if(!name)return;run(async()=>{if(demo){setFamily(f=>f&&{...f,name});return;}const r=await supabase!.from('hg_families').update({name}).eq('id',family.id).select('id');if(r.error)throw r.error;if(!r.data?.length)throw new Error('모임 소유자만 이름을 바꿀 수 있어요.');await load();});}}>이름 바꾸기</button>}</h2>
        {data.members.map(m => <div className="member-row" key={m.user_id}><span className="avatar" style={{ background: memberColor(data.members, m.user_id).bg, color: memberColor(data.members, m.user_id).fg }}>{m.display_name.slice(0,1)}</span><div><strong>{m.display_name}{m.user_id===uid&&' (나)'}</strong><small>{m.user_id === family.owner_id ? '모임 소유자' : '구성원'}</small></div>
          <span className="member-actions">{m.user_id===uid&&<button className="text-button" disabled={busy} onClick={()=>{const name=window.prompt('이 모임에서 보일 이름',m.display_name)?.trim();if(!name)return;run(async()=>{if(demo){setData(d=>({...d,members:d.members.map(x=>x.user_id===uid?{...x,display_name:name}:x)}));return;}const r=await supabase!.from('hg_members').update({display_name:name}).eq('family_id',family.id).eq('user_id',uid);if(r.error)throw r.error;await load();});}}>이름 바꾸기</button>}
          {family.owner_id===uid&&m.user_id!==uid&&<><button className="text-button" disabled={busy} onClick={()=>{if(!window.confirm(`${m.display_name}님에게 모임 소유권을 넘길까요?`))return;run(async()=>{if(demo)throw new Error('미리보기에서는 바꿀 수 없어요.');const r=await supabase!.rpc('hg_transfer_ownership',{family:family.id,member:m.user_id});if(r.error)throw r.error;await load();});}}>소유권 넘기기</button><button className="text-button danger" disabled={busy} onClick={()=>{if(!window.confirm(`${m.display_name}님을 모임에서 내보낼까요? 그분이 남긴 기록은 남아요.`))return;run(async()=>{if(demo)throw new Error('미리보기에서는 바꿀 수 없어요.');const r=await supabase!.rpc('hg_remove_member',{family:family.id,member:m.user_id});if(r.error)throw r.error;await load();});}}>내보내기</button></>}</span></div>)}
        {family.owner_id===uid&&<label className="inline-label settle-toggle"><input type="checkbox" checked={!!family.settings?.settlement} disabled={busy} onChange={e=>{const settings={...(family.settings||{}),settlement:e.target.checked};run(async()=>{ if(demo){setFamily(f=>f&&{...f,settings});return;} const r=await supabase!.from('hg_families').update({settings}).eq('id',family.id).select('id'); if(r.error)throw r.error; setFamily(f=>f&&{...f,settings}); });}}/>월말 정산 사용 — 지출을 공동/개인으로 나누고 리포트에 “누가 누구에게” 정산 패널을 보여요</label>}
        {!demo&&<button className="text-button danger" disabled={busy} onClick={()=>{if(!window.confirm(family.owner_id===uid&&data.members.length===1?'마지막 멤버예요. 나가면 이 모임의 기록·사진이 모두 삭제돼요. 계속할까요?':'이 모임에서 나갈까요? 내가 남긴 기록은 남아요.'))return;run(async()=>{const r=await supabase!.rpc('hg_leave_family',{family:family.id});if(r.error)throw r.error;requestVersion.current++;localStorage.removeItem(`haraguri-space-${uid}`);setActiveSpace('');setFamily(null);setData(emptyData);setTab('home');await load();});}}>모임 나가기</button>}{family.owner_id === uid && <><h2 className="list-title">가족 초대</h2><h3>닉네임·이메일로 초대</h3><p>상대의 카카오 닉네임이나 로그인 이메일을 적어 두면, 그분이 로그인했을 때 ‘초대받은 모임’으로 떠서 한 번에 참여해요. 30일 동안 유효해요.</p>
  <form className="target-form" onSubmit={e => { e.preventDefault(); const f = e.currentTarget; const target = String(new FormData(f).get('target') || '').trim(); if (!target) return; run(async () => {
    if (demo) throw new Error('실제 초대는 로그인 후 사용할 수 있어요.');
    const r = await supabase!.from('hg_invite_targets').insert({ family_id: family.id, target, invited_by: uid }).select('id,target,expires_at').single();
    if (r.error) throw new Error(r.error.code === '23505' ? `'${target}'은(는) 이미 등록돼 있어요.` : r.error.message);
    setTargets(t => [...t, r.data as TargetRow]); f.reset(); setNotice(`'${target}'님이 로그인하면 이 모임 초대가 보여요.`);
  }); }}><label>카카오 닉네임 또는 이메일<input name="target" required maxLength={120} autoComplete="off" placeholder="예: 지유엄마 / mom@example.com"/></label><button className="secondary" disabled={busy}>초대 등록</button></form>
  {targets.map(t => <div className="target-row" key={t.id}><span>{t.target}<small className="muted"> · {t.expires_at.slice(0, 10)}까지</small></span><button className="text-button" disabled={busy} onClick={() => run(async () => { const r = await supabase!.from('hg_invite_targets').delete().eq('id', t.id); if (r.error) throw r.error; setTargets(x => x.filter(y => y.id !== t.id)); })}>취소</button></div>)}
  <h3>초대 링크·코드</h3><p>새 코드를 발급하면 이전 코드는 만료됩니다. 코드는 7일 동안 유효해요.</p><button className="primary" disabled={busy} onClick={() => run(async () => { if(demo) throw new Error('실제 가족 초대는 로그인 후 사용할 수 있어요.'); const r = await supabase!.rpc('hg_invite',{family:family.id}); if(r.error) throw r.error; setInvite(r.data); })}>초대 코드 발급</button>{invite && <div className="invite-box"><label>초대 링크 (7일 유효)<input readOnly value={inviteLink(invite)} onFocus={e => e.target.select()} aria-label="초대 링크"/></label>
  <div className="ingest-actions"><button className="primary" onClick={()=>{navigator.clipboard?.writeText(inviteLink(invite)).then(()=>setNotice('초대 링크를 복사했어요. 카톡으로 보내 주세요.')).catch(()=>setError('복사가 막혀 있어요. 링크를 길게 눌러 복사해 주세요.'));}}>링크 복사</button>
  {typeof navigator!=='undefined'&&'share' in navigator&&<button className="secondary" onClick={()=>navigator.share({title:'HARAGURI 초대',text:`'${family.name}' 모임에 초대해요. 링크를 눌러 카카오 로그인하면 바로 참여돼요. (7일 유효)`,url:inviteLink(invite)}).catch(()=>undefined)}>공유하기</button>}</div>
  <small className="muted">상대가 링크를 누르면 로그인 후 자동으로 참여해요.</small></div>}</>}{!demo&&<><h2 className="list-title">사진·문서 사용량</h2>{usage?<div className="usage-block"><p><b>{formatBytes(usage.bytes)}</b> / {formatBytes(usage.limit)} · {usage.files.toLocaleString('ko-KR')}개 · <b className={usagePercent>=80?'usage-warn':''}>{usagePercent}%</b> 사용 중</p><progress aria-label="저장공간 사용률" value={usagePercent} max={100} className={usagePercent>=80?'warn':''}/>{usagePercent>=80&&<p className="usage-warn">한도에 가까워요. 끝난 일의 대화를 종료하면 그 방의 사진·문서가 정리돼요.</p>}<small className="muted">모임마다 {formatBytes(usage.limit)}까지 올릴 수 있어요. 사진은 긴 변 1,600px으로 줄여 올리고, 문서는 원본 그대로예요.</small></div>:<p>사용량을 확인하고 있어요…</p>}<h2 className="list-title">알림</h2><div className="push-block">{push==='on'&&<><p>이 기기로 푸시 알림을 받고 있어요.</p><PushPrefs busy={busy} onError={setError}/><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await disablePush();await refreshPush();setNotice('이 기기의 푸시 알림을 껐어요.');})}>이 기기 알림 끄기</button></>}
{push==='off'&&<><p>앱을 닫아 둔 동안에도 새 메시지와 아침 할 일 알림을 받으려면 켜 주세요. 기기마다 따로 켭니다.</p><button className="primary" disabled={busy} onClick={()=>run(async()=>{await enablePush(user!.id);await refreshPush();setNotice('푸시 알림을 켰어요. 가족이 메시지를 남기면 이 기기로 와요.');})}>이 기기에서 푸시 알림 받기</button></>}
{push==='needs-install'&&<p>iPhone은 Safari 공유 메뉴 → ‘홈 화면에 추가’로 설치한 뒤 그 앱에서 알림을 켤 수 있어요(iOS 16.4 이상).</p>}
{push==='denied'&&<p>이 브라우저에서 알림이 차단돼 있어요. 주소창 자물쇠 → 알림 → 허용으로 바꾼 뒤 새로고침해 주세요.</p>}
{push==='unsupported'&&<p>이 브라우저는 푸시 알림을 지원하지 않아요. 앱 안의 알림 모음은 그대로 쓸 수 있어요.</p>}</div>
<h2 className="list-title">가계부 자동 수집</h2>{demo?<p className="muted">로그인하면 결제 문자·카드앱 알림을 자동으로 가계부에 받아올 수 있어요.</p>:<AutoCollectSummary state={collect} onOpen={()=>{setCollectOpen(true);setTab('money');}}/>}
<h2 className="list-title">로그인 계정</h2>{user?.email&&<p>{user.email}</p>}{user?.identities?.some(i=>i.provider==='kakao')?<p>카카오 계정이 연결되어 있어요.</p>:<><p>기존 기록을 유지하려면 현재 계정에 카카오 로그인을 연결하세요.</p><button className="kakao-button" disabled={busy} onClick={()=>run(()=>startKakaoLogin(true))}><KakaoGlyph/>카카오 계정 연결</button></>}</>}<h2 className="list-title">홈 화면에 설치</h2><p>iPhone은 Safari 공유 메뉴에서 ‘홈 화면에 추가’를, Android는 브라우저 메뉴의 ‘앱 설치’를 선택하세요.</p><h2 className="list-title">기록 공유</h2><p>가족 공간의 일정, 지출, 댓글과 첨부파일은 참여한 가족 모두에게 공유됩니다.</p><button className="secondary" disabled={busy} onClick={() => run(async () => { if(!demo) { const r = await supabase!.auth.signOut(); if(r.error) throw r.error; } setDemo(false); setFamily(null); setSpaces([]); setActiveSpace(''); setData(emptyData); setSelected(null); setInvite(''); })}>{demo ? '미리보기 나가기' : '로그아웃'}</button></section>}
      <footer>HARAGURI <span>우리 가족의 작은 기록들</span></footer>
    </main>
    {(tab==='home'||tab==='calendar')&&<button className="fab" aria-label="일정·할 일 추가" onClick={()=>{setEntryDate('');setForm('entry');}}>＋</button>}
    {tab==='money'&&<button className="fab" aria-label="지출 기록" onClick={()=>openExpense()}>₩</button>}
    <nav className="bottom-nav" aria-label="모바일 메뉴">{tabs.map(([key,icon,title]) => <button key={key} aria-label={title} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={() => setTab(key)}><span>{icon}</span>{title}{key==='chat'&&unreadFamilyTotal>0&&<b className="nav-badge" aria-label={`안 읽은 메시지 ${unreadFamilyTotal}개`}>{unreadFamilyTotal}</b>}</button>)}</nav>
    {captureOpen && <Modal title="카드앱 캡처로 가져오기" close={()=>{if(!busy){setCaptureOpen(false);setCaptureFiles(null);}}}><CaptureImport key={captureFiles?captureFiles.length:'pick'} initialFiles={captureFiles??undefined} cards={data.cards} expenses={data.expenses} rules={data.rules} busy={busy} onImport={(rows,cardId)=>run(()=>importRows(rows,cardId)).then(()=>undefined)} onAi={!demo&&aiReady?aiRecognize:undefined}/></Modal>}
    {form && <Modal title={form==='entry'?(editingEntry?'일 수정하기':'함께할 일 남기기'):form==='expense'?(editingExpense?(editingExpense.reviewed===false?'자동 등록 확인·수정':'지출 수정하기'):'지출 기록하기'):form==='budget'?'예산 설정':form==='envelope'?'적립 봉투 만들기':form==='recurring'?'매월 반복 지출 추가':(editingCard?'카드 설정':'카드·실적 목표 추가')} close={()=>{if(!busy){setForm(null);setEditingEntry(null);}}}>
      <form onSubmit={submitForm}>{error&&<p role="alert" className="error banner">{error}</p>}
        {form==='budget'?<BudgetFields budget={budgetFor(data.budgets,month)} month={month}/>:form==='envelope'?<EnvelopeFields/>:form==='recurring'?<RecurringFields cards={data.cards} initial={recurringPrefill}/>:form==='card'?<CardFields card={editingCard} members={data.members}/>:form==='expense'?<>{!editingExpense&&<><SmsPaste cards={data.cards} initial={prefillText} onParsed={prefill=>{setExpensePrefill(prefill);setPrefillKey(k=>k+1);}}/><button type="button" className="text-button sms-toggle" onClick={()=>{setForm(null);setCaptureOpen(true);}}>📷 카드앱 캡처로 여러 건 가져오기</button></>}<ExpenseFields key={prefillKey} expense={editingExpense ?? expensePrefill} cards={data.cards} rules={data.rules} settlement={!!family.settings?.settlement} remembered={readLastPay()} openAdvanced={!!expenseRoom} extra={<ExpenseWorkFields entries={data.entries} expense={editingExpense} room={expenseRoom}/>}/></>:<WorkFields key={editingEntry?.id ?? 'new'} members={data.members} date={entryDate || today()} entry={editingEntry} locked={!!editingEntry&&entryLocked}/>}
        <button className="primary" disabled={busy}>{busy?'저장 중…':'저장하기'}</button>
      </form>
    </Modal>}
    {shared && !form && <Modal title="공유받은 항목" close={()=>{if(!busy)setShared(null);}}>
      <div className="detail">
        {shared.files.length>0&&shared.files.some(f=>/^image\//.test(f.type))&&<div className="share-capture"><button className="secondary" disabled={busy} onClick={()=>{const imgs=shared.files.filter(f=>/^image\//.test(f.type));setShared(null);setCaptureFiles(imgs);setCaptureOpen(true);}}>📷 카드앱 이용내역 캡처예요 → 거래로 가져오기</button><small className="muted">폰 안에서만 읽고 서버로 보내지 않아요.</small></div>}
        {shared.files.length>0&&<><p className="muted">사진·문서 {shared.files.length}개를 어디에 올릴까요?</p><ul className="share-list">{shared.files.slice(0,10).map((f,i)=><li key={i}>{f.name} · {formatBytes(f.size)}</li>)}</ul>
          <label>올릴 곳<select aria-label="올릴 곳" value={shareDest} onChange={e=>setShareDest(e.target.value)}><option value="general">가족 기본 채팅</option>{data.entries.filter(e=>!isClosed(data.rooms,{entry:e,date:roomDate(e,today().slice(0,7))})).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30).map(e=><option key={e.id} value={e.id}>{e.title} · {roomDate(e,today().slice(0,7))}</option>)}</select></label>
          <div className="share-actions"><button className="primary" disabled={busy} onClick={()=>run(async()=>{const entry=data.entries.find(e=>e.id===shareDest);const room:Room=entry?{entry,date:roomDate(entry,today().slice(0,7))}:null;await upload(shared.files.slice(0,10),room);setShared(null);if(room){setSelected(room);}else{setTab('chat');setChatView('general');}})}>{busy?'올리는 중…':`${Math.min(10,shared.files.length)}개 올리기`}</button></div></>}
        {shared.text&&<><p className="muted">{shared.files.length?'함께 온 글':'공유받은 글'}</p><div className="share-text">{shared.text}</div>
          <div className="share-actions">{parseCardMessage(shared.text)&&<button className="primary" disabled={busy} onClick={()=>{const text=shared.text;setShared(null);openExpense(null,null,text);}}>₩ 카드 결제로 가계부에 기록</button>}<button className="secondary" disabled={busy} onClick={()=>run(async()=>{await sendComment({family_id:family.id,entry_id:null,occurrence:null,body:shared.text.slice(0,5000),created_by:uid});setShared(null);setTab('chat');setChatView('general');})}>가족 기본 채팅에 보내기</button></div></>}
        <button className="text-button" onClick={()=>setShared(null)}>닫기</button>
      </div>
    </Modal>}
    {selected && !form && <Modal title={selected.entry.title} close={()=>{if(!busy)setSelected(null);}}>
      <div className="detail work-detail">{error&&<p role="alert" className="error banner">{error}</p>}
        <div className="detail-tools"><button className="text-button" onClick={e=>e.currentTarget.closest('dialog')?.querySelector('.chat-room')?.scrollIntoView({block:'start',behavior:'smooth'})}>대화 바로가기 ↓</button><button className="text-button" disabled={busy} onClick={()=>openEntryEdit(selected.entry)}>✎ 수정</button></div><div className="detail-meta">{selected.date} · {repeatLabel[selected.entry.repeat]} · {selected.entry.assignee?name(selected.entry.assignee):'함께'}</div>
        <p className="body-copy">{selected.entry.body || '함께 이야기하며 내용을 채워보세요.'}</p>
        <div className="work-money"><span>예상 금액<strong>{money(selected.entry.expected_amount || 0)}</strong></span><span>연결된 실제 지출<strong>{money(workExpenses(data.expenses,selected).reduce((sum,e)=>sum+Number(e.amount),0))}</strong></span></div>
        {selected.entry.kind==='purchase'&&<label>구매 진행<select aria-label="구매 진행" value={selected.entry.purchase_state || 'discussing'} disabled={busy} onChange={e=>run(()=>update('entries','hg_entries',selected.entry.id,{purchase_state:e.target.value}))}>{Object.entries(purchaseStates).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><small className="muted">구매 완료로 바꿔도 지출이 자동 생성되지 않아요. 실제 결제를 아래에 연결하세요.</small></label>}
        <div className="detail-actions">{(['done'] as const).map(state=>{const mine=data.receipts.some(r=>r.entry_id===selected.entry.id&&r.occurrence===selected.date&&r.user_id===uid&&r.state===state);return <button key={state} className={mine?'primary':'secondary'} aria-pressed={mine} disabled={busy} onClick={()=>run(()=>receipt(state))}>{mine?'✓ ':''}완료했어요</button>;})}</div>
        <div className="receipt-list">{data.receipts.filter(r=>inRoom(r,selected)).map(r=><span key={r.id}>{name(r.user_id)} · {r.state==='seen'?'확인':'완료'}</span>)}</div>
        <button className="secondary" disabled={busy} onClick={()=>run(async()=>{await sendComment({family_id:family.id,entry_id:null,occurrence:null,shared_entry_id:selected.entry.id,shared_occurrence:selected.date,body:`${selected.entry.title} 함께 확인해 주세요.`,created_by:uid});setSelected(null);setTab('chat');setChatView('general');})}>가족 기본 채팅에 공유</button>
        <h3>관련 지출</h3>{workExpenses(data.expenses,selected).map(e=><div className="expense-row" key={e.id}><div><strong>{e.title}</strong><small>{e.date} · {e.category}</small></div><b>{money(e.amount)}</b>{e.created_by===uid&&<button className="text-button" onClick={()=>openExpense(e,selected)}>수정</button>}</div>)}
        <div className="work-expense-actions"><button className="secondary" onClick={()=>openExpense(null,selected)}>＋ 결제·환불 기록</button><label>기존 지출 연결<select aria-label="기존 지출 연결" value="" disabled={busy} onChange={e=>{const id=e.target.value;if(id)run(()=>update('expenses','hg_expenses',id,{entry_id:selected.entry.id,occurrence:selected.date}));}}><option value="">이미 입력한 지출 선택</option>{data.expenses.filter(e=>e.kind!=='income'&&e.kind!=='transfer'&&e.created_by===uid&&!e.entry_id).map(e=><option key={e.id} value={e.id}>{e.date} · {e.title} · {money(e.amount)}</option>)}</select></label></div>
        {!isClosed(data.rooms,selected)&&looksFinished(selected.entry,selected.date,data.receipts)&&!dismissedFinish.has(`${selected.entry.id}|${selected.date}`)&&<div className="finish-banner" role="status"><p>{selected.entry.kind==='purchase'?'구매가 마무리됐어요.':'이 일이 끝났어요.'} 대화를 종료하면 사진·문서는 정리되고 글은 남아요.</p><button className="primary" disabled={busy} onClick={()=>run(()=>closeRoom(selected))}>대화 종료</button><button className="text-button" onClick={()=>setDismissedFinish(d=>new Set(d).add(`${selected.entry.id}|${selected.date}`))}>나중에</button></div>}
        <Chat key={`${selected.entry.id}-${selected.date}`} room={selected} unreadCount={unreadMap[`${selected.entry.id}:${selected.date}`]||0} state={roomState(data.rooms,selected)} comments={detail.comments} attachments={detail.attachments} hasMore={detail.hasMore} loadingOlder={detail.loading} loadError={detail.error} onOlder={detail.loadOlder} entries={data.entries} uid={uid} name={name} busy={busy} sync={sync} onOpen={(entry,date)=>setSelected({entry,date})} onSend={(body,replyTo)=>run(()=>sendComment({family_id:family.id,entry_id:selected.entry.id,occurrence:selected.date,body,created_by:uid,reply_to:replyTo??null}))} {...socialFor(selected,detailSocialLive)} othersCount={Math.max(0,data.members.length-1)} onReact={(id,e)=>run(()=>react(id,e))} onPin={id=>run(()=>pinMessage(selected,id))} onUnpin={()=>run(()=>unpin(selected))} onPhotoUrl={photoUrl} onSearch={searchMessages} onJump={jumpToHit} highlightId={highlightId} onEdit={(id,body)=>run(()=>editComment(id,body))} onDelete={id=>run(()=>deleteComment(id))} onUpload={files=>run(()=>upload(files))} onFile={file=>run(()=>openFile(file))} onClose={()=>run(()=>closeRoom(selected))} onReopen={()=>run(()=>reopenRoom(selected))}/>
        {selected.entry.created_by===uid&&<button className="text-button danger" disabled={busy} onClick={()=>{if(!window.confirm('이 일과 반복 회차의 대화·확인 기록을 모두 삭제할까요?'))return;run(async()=>{
          const links=await entryLinks(selected.entry.id);
          if(links.attachments||links.expenses||links.shared)throw new Error('사진·지출·공유 대화가 연결된 일은 삭제할 수 없어요.');
          if(demo){setData(d=>({...d,entries:d.entries.filter(e=>e.id!==selected.entry.id),receipts:d.receipts.filter(r=>r.entry_id!==selected.entry.id)}));setDemoRooms(d=>({...d,comments:d.comments.filter(c=>c.entry_id!==selected.entry.id)}));}else{const r=await supabase!.from('hg_entries').delete().eq('id',selected.entry.id);if(r.error)throw r.error;await load();}setSelected(null);
        });}}>일정 전체 삭제</button>}
      </div>
    </Modal>}
  </div>;
}
