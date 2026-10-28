'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Attachment, Comment, Entry, Pin, REACTION_EMOJI, Reaction, RoomRead, RoomState } from '../lib/model';
import { Room } from '../lib/work';
import { SearchHit, useSignedPhotos } from '../lib/chat';
import { formatBytes } from '../lib/image';

export const MAX_FILES_PER_UPLOAD = 10;
const GROUP_GAP = 5 * 60 * 1000; // consecutive messages by the same person within 5 minutes share one header
const MAX_VOICE_SECONDS = 60;
const VOICE = false; // hidden for now: KakaoTalk does voice better and iOS recording formats are unverified
type Pending = { id: string; body: string; time: string; failed: boolean; replyTo: string | null };
type Row = { type: 'message'; id: string; time: string; message: Comment } | { type: 'file'; id: string; time: string; file: Attachment } | { type: 'photos'; id: string; time: string; files: Attachment[] } | { type: 'pending'; id: string; time: string; pending: Pending };

const isImage = (f: Attachment) => /\.(png|jpe?g|webp)$/i.test(f.path);
const isAudio = (f: Attachment) => /\.(webm|m4a|mp4|mp3|ogg|aac)$/i.test(f.path);
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');
function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const key = dayKey(iso);
  if (key === today.toLocaleDateString('sv-SE')) return '오늘';
  if (key === yesterday.toLocaleDateString('sv-SE')) return '어제';
  return `${d.getFullYear() !== today.getFullYear() ? `${d.getFullYear()}년 ` : ''}${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const snippet = (s: string, n = 60) => s.length > n ? `${s.slice(0, n)}…` : s;
function authorOf(row: Row, uid: string) { return row.type === 'message' ? row.message.created_by : row.type === 'file' ? row.file.created_by : row.type === 'photos' ? row.files[0].created_by : uid; }

export function Chat({room,state,comments,attachments,entries,uid,name,busy,sync,hasMore,loadingOlder,loadError,onOlder,onSend,onEdit,onDelete,onUpload,onFile,onOpen,onClose,onReopen,unreadCount=0,
  reactions=[],reads=[],pin=null,othersCount=0,onReact,onPin,onUnpin,onPhotoUrl,onSearch,onJump,highlightId=null}: {
  room:Room;state?:RoomState;comments:Comment[];attachments:Attachment[];entries:Entry[];uid:string;name:(id:string)=>string;busy:boolean;sync:string;
  hasMore:boolean;loadingOlder:boolean;loadError:string;onOlder:()=>void;
  onSend:(body:string,replyTo?:string|null)=>Promise<boolean>;onEdit:(id:string,body:string)=>Promise<boolean>;onDelete:(id:string)=>void;onUpload:(files:File[])=>void;onFile:(file:Attachment)=>void;onOpen:(entry:Entry,date:string)=>void;
  onClose?:()=>void;onReopen?:()=>void;unreadCount?:number;
  reactions?:Reaction[];reads?:RoomRead[];pin?:(Pin&{comment:Comment|null})|null;othersCount?:number;
  onReact?:(commentId:string,emoji:string)=>void;onPin?:(commentId:string)=>void;onUnpin?:()=>void;onPhotoUrl?:(file:Attachment)=>Promise<string|null>;
  onSearch?:(q:string)=>Promise<SearchHit[]>;onJump?:(hit:SearchHit)=>void;highlightId?:string|null;
}) {
  const [draft,setDraft]=useState('');
  const [pending,setPending]=useState<Pending[]>([]);
  const [editing,setEditing]=useState<{id:string;body:string}|null>(null);
  const [replyTo,setReplyTo]=useState<Comment|null>(null);
  const [menu,setMenu]=useState<string|null>(null); // message whose long-press / right-click menu is open
  const [fresh,setFresh]=useState(0); // messages that arrived while the reader was scrolled up
  const [flash,setFlash]=useState<string|null>(null); // message briefly highlighted after a jump
  const [viewer,setViewer]=useState<{file:Attachment;url:string|null}|null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [hits,setHits]=useState<SearchHit[]|null>(null);
  const [rec,setRec]=useState<{recorder:MediaRecorder;chunks:Blob[];started:number}|null>(null);
  const [recSeconds,setRecSeconds]=useState(0);
  const list=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const divider=useRef<HTMLDivElement>(null);
  const nearBottom=useRef(true);
  const keepOffset=useRef<number|null>(null);
  const positioned=useRef(false);
  const pressTimer=useRef<number|null>(null);
  const touchX=useRef<number|null>(null);
  const initialUnread=useRef(unreadCount); // where the "read up to here" line goes; fixed when the room opens
  const photos=useSignedPhotos(attachments);
  const closed=!!state?.closed_at;
  const canRecord=VOICE&&typeof window!=='undefined'&&'MediaRecorder' in window&&!!navigator.mediaDevices?.getUserMedia;

  // A pending bubble disappears as soon as the real row arrives (same author, same text, within two minutes).
  useEffect(()=>{ if(pending.length) setPending(p=>p.filter(x=>x.failed||!comments.some(c=>c.created_by===uid&&c.body===x.body&&Math.abs(new Date(c.created_at).getTime()-new Date(x.time).getTime())<120000))); },[comments]); // eslint-disable-line react-hooks/exhaustive-deps
  // Consecutive photos from one person become a grid instead of a column of bubbles.
  const sorted:Row[]=[...comments.map(m=>({type:'message' as const,id:m.id,time:m.created_at,message:m})),...attachments.map(f=>({type:'file' as const,id:f.id,time:f.created_at || '',file:f})),...pending.map(p=>({type:'pending' as const,id:p.id,time:p.time,pending:p}))].sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
  const timeline:Row[]=[];
  for(const row of sorted){
    const prev=timeline.at(-1);
    if(row.type==='file'&&isImage(row.file)&&prev&&prev.type==='photos'&&prev.files[0].created_by===row.file.created_by&&new Date(row.time).getTime()-new Date(prev.files.at(-1)!.created_at||prev.time).getTime()<GROUP_GAP&&prev.files.length<9){ prev.files.push(row.file); continue; }
    if(row.type==='file'&&isImage(row.file)){ timeline.push({type:'photos',id:row.id,time:row.time,files:[row.file]}); continue; }
    timeline.push(row);
  }
  const images=timeline.flatMap(r=>r.type==='photos'?r.files:[]);
  const last=timeline.at(-1)?.id;
  const first=timeline[0]?.id;
  const othersIdx=timeline.flatMap((r,i)=>r.type!=='pending'&&authorOf(r,uid)!==uid?[i]:[]);
  const unreadStart=initialUnread.current>0&&othersIdx.length?othersIdx[Math.max(0,othersIdx.length-initialUnread.current)]:-1;
  const reactionsFor=(id:string)=>{ const m=new Map<string,{count:number;mine:boolean}>(); for(const r of reactions) if(r.comment_id===id){ const e=m.get(r.emoji)||{count:0,mine:false}; e.count++; if(r.user_id===uid) e.mine=true; m.set(r.emoji,e); } return [...m.entries()]; };
  const readersOf=(iso:string)=>reads.filter(r=>r.user_id!==uid&&new Date(r.last_read_at).getTime()>=new Date(iso).getTime()).length;

  // Older pages are inserted above; keep what the reader was looking at in place.
  useLayoutEffect(()=>{const el=list.current;if(!el)return;if(keepOffset.current!=null){el.scrollTop=el.scrollHeight-keepOffset.current;keepOffset.current=null;}},[first]);
  // First paint: land on the unread line if there is one, otherwise at the bottom.
  useLayoutEffect(()=>{ if(positioned.current||!timeline.length) return; positioned.current=true; const el=list.current; if(!el) return; if(divider.current){ el.scrollTop=Math.max(0,divider.current.offsetTop-40); nearBottom.current=false; } else el.scrollTop=el.scrollHeight; },[timeline.length]);
  useLayoutEffect(()=>{ const el=list.current; if(!el||!positioned.current||keepOffset.current!=null) return; if(nearBottom.current){ el.scrollTop=el.scrollHeight; setFresh(0); } else setFresh(n=>n+1); },[last]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!menu) return; const close=()=>setMenu(null); document.addEventListener('click',close); document.addEventListener('keydown',close); return ()=>{ document.removeEventListener('click',close); document.removeEventListener('keydown',close); }; },[menu]);
  useEffect(()=>{ if(highlightId) jumpTo(highlightId); },[highlightId,comments.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!viewer||!onPhotoUrl) return; let active=true; onPhotoUrl(viewer.file).then(url=>{ if(active&&url) setViewer(v=>v&&v.file.id===viewer.file.id?{...v,url}:v); }); return ()=>{ active=false; }; },[viewer?.file.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!viewer) return; const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') setViewer(null); if(e.key==='ArrowLeft') stepViewer(-1); if(e.key==='ArrowRight') stepViewer(1); }; document.addEventListener('keydown',onKey); return ()=>document.removeEventListener('keydown',onKey); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!onSearch||!searchOpen) return; const q=query.trim(); if(q.length<1){ setHits(null); return; } const t=setTimeout(()=>{ onSearch(q).then(setHits).catch(()=>setHits([])); },300); return ()=>clearTimeout(t); },[query,searchOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!rec) return; const t=setInterval(()=>{ const s=Math.round((Date.now()-rec.started)/1000); setRecSeconds(s); if(s>=MAX_VOICE_SECONDS) stopRecording(true); },250); return ()=>clearInterval(t); }); // eslint-disable-line react-hooks/exhaustive-deps

  const autosize=(el:HTMLTextAreaElement)=>{ el.style.height='auto'; el.style.height=`${Math.min(el.scrollHeight,140)}px`; };
  async function sendBody(body:string,reply:string|null){
    const row:Pending={id:`p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,body,time:new Date().toISOString(),failed:false,replyTo:reply};
    setPending(p=>[...p,row]); nearBottom.current=true;
    const ok=await onSend(body,reply);
    if(!ok) setPending(p=>p.map(x=>x.id===row.id?{...x,failed:true}:x));
  }
  function submit(){ const body=draft.trim(); if(!body||busy) return; setDraft(''); if(input.current){ input.current.style.height='auto'; } const reply=replyTo?.id ?? null; setReplyTo(null); void sendBody(body,reply); }
  const startPress=(id:string)=>{ if(pressTimer.current) window.clearTimeout(pressTimer.current); pressTimer.current=window.setTimeout(()=>setMenu(id),500); };
  const cancelPress=()=>{ if(pressTimer.current){ window.clearTimeout(pressTimer.current); pressTimer.current=null; } };
  const jumpToBottom=()=>{ const el=list.current; if(el) el.scrollTop=el.scrollHeight; nearBottom.current=true; setFresh(0); };
  function jumpTo(id:string){ const el=list.current?.querySelector<HTMLElement>(`[data-id="${id}"]`); if(!el) return false; el.scrollIntoView({block:'center'}); setFlash(id); window.setTimeout(()=>setFlash(f=>f===id?null:f),2000); return true; }
  function stepViewer(delta:number){ if(!viewer) return; const i=images.findIndex(f=>f.id===viewer.file.id); const next=images[i+delta]; if(next) setViewer({file:next,url:null}); }
  async function startRecording(){
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'].find(m=>MediaRecorder.isTypeSupported(m))||'';
      const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
      const chunks:Blob[]=[];
      recorder.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
      recorder.onstop=()=>{ stream.getTracks().forEach(t=>t.stop()); const type=recorder.mimeType||mime||'audio/webm'; const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm'; const blob=new Blob(chunks,{type:type.split(';')[0]}); if(blob.size>0&&!cancelRef.current) onUpload([new File([blob],`음성 메시지 ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}.${ext}`,{type:type.split(';')[0]})]); cancelRef.current=false; setRec(null); setRecSeconds(0); };
      recorder.start(250);
      setRec({recorder,chunks,started:Date.now()});
    }catch{ window.alert('마이크를 사용할 수 없어요. 브라우저 설정에서 마이크 권한을 확인해 주세요.'); }
  }
  const cancelRef=useRef(false);
  function stopRecording(send:boolean){ if(!rec) return; cancelRef.current=!send; if(rec.recorder.state!=='inactive') rec.recorder.stop(); }

  return <section className="chat-room" aria-label={room?'이 일의 대화':'가족 기본 채팅'}>
    <div className="section-head chat-head"><h3>{room?'이 일의 대화':'가족 기본 채팅'}{closed&&<span className="room-closed-badge">종료됨</span>}</h3><small className="muted" role="status">{sync}</small>
      {onSearch&&<button type="button" className="icon-button chat-search-toggle" aria-label="대화 검색" aria-expanded={searchOpen} onClick={()=>{setSearchOpen(o=>!o);setQuery('');setHits(null);}}>⌕</button>}
      {room&&onClose&&!closed&&<button type="button" className="text-button" disabled={busy} onClick={onClose}>대화 종료</button>}</div>
    {searchOpen&&onSearch&&<div className="chat-search"><input aria-label="대화 검색어" value={query} autoFocus placeholder="메시지 검색" onChange={e=>setQuery(e.target.value)}/>
      {hits&&<div className="search-hits" role="list">{hits.length?hits.map(h=><button key={h.id} role="listitem" onClick={()=>{ if(!jumpTo(h.id)) onJump?.(h); else setSearchOpen(false); }}><b>{h.room_title}</b> · {name(h.created_by)} · <time>{dayLabel(h.created_at)} {clock(h.created_at)}</time><span>{snippet(h.body,90)}</span></button>):<p className="muted">검색 결과가 없어요.</p>}</div>}</div>}
    {pin&&<div className="pin-banner" role="note"><button type="button" className="pin-body" onClick={()=>{ if(pin.comment&&!jumpTo(pin.comment_id)) window.alert('고정한 메시지가 이전 대화에 있어요. 위로 올라가 "이전 대화 보기"를 눌러 주세요.'); }}>📌 <b>{pin.comment?name(pin.comment.created_by):'고정'}</b> {pin.comment?snippet(pin.comment.body,80):'고정된 메시지'}</button>{onUnpin&&<button type="button" className="icon-button" aria-label="고정 해제" onClick={onUnpin}>×</button>}</div>}
    <div className="chat-messages" ref={list} role="log" aria-label="대화 내역" aria-live="polite" onScroll={()=>{const el=list.current!;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;if(nearBottom.current)setFresh(0);}}>
      {hasMore&&<button className="secondary chat-older" disabled={loadingOlder} onClick={()=>{const el=list.current;if(el)keepOffset.current=el.scrollHeight-el.scrollTop;onOlder();}}>{loadingOlder?'불러오는 중…':'이전 대화 보기'}</button>}
      {loadError&&<p role="alert" className="error banner">{loadError}</p>}
      {!timeline.length&&!loadingOlder&&<div className="empty">{closed?'종료된 대화예요.':room?'사진과 의견을 남겨 함께 결정해 보세요.':'일상 이야기는 여기서 편하게 나눠요.'}</div>}
      {timeline.map((row,i)=>{
        const author=authorOf(row,uid); const mine=author===uid; const prev=timeline[i-1];
        const newDay=!prev||dayKey(prev.time)!==dayKey(row.time);
        const grouped=!newDay&&!!prev&&authorOf(prev,uid)===author&&new Date(row.time).getTime()-new Date(prev.time).getTime()<GROUP_GAP&&i!==unreadStart;
        const readers=mine&&row.type!=='pending'?readersOf(row.time):0;
        const readMark=mine&&othersCount>0&&readers>0?(readers>=othersCount?'읽음':`읽음 ${readers}`):'';
        const quoted=row.type==='message'&&row.message.reply_to?comments.find(c=>c.id===row.message.reply_to):row.type==='pending'&&row.pending.replyTo?comments.find(c=>c.id===row.pending.replyTo):undefined;
        const chips=row.type==='message'?reactionsFor(row.id):[];
        return <Fragment key={row.id}>
          {newDay&&<div className="chat-date" role="separator">{dayLabel(row.time)}</div>}
          {i===unreadStart&&<div className="chat-unread" ref={divider} role="separator">여기까지 읽었어요</div>}
          <div className={`chat-line ${mine?'mine':''} ${grouped?'grouped':''} ${flash===row.id?'flash':''}`} data-id={row.id}>
            {!mine&&!grouped&&<small className="chat-author">{name(author)}</small>}
            {(quoted||(row.type==='message'&&row.message.reply_to))&&<button type="button" className="quote" onClick={()=>{ if(quoted) jumpTo(quoted.id); }}>{quoted?<><b>{name(quoted.created_by)}</b><span>{snippet(quoted.body)}</span></>:<span className="muted">원본 메시지를 불러올 수 없어요</span>}</button>}
            <div className="bubble-row">
              {row.type==='pending'?<p className="chat-bubble pending">{row.pending.body}</p>
              :row.type==='message'?(editing?.id===row.id
                ?<form className="chat-edit" onSubmit={async e=>{e.preventDefault();const body=editing.body.trim();if(!body)return;if(await onEdit(row.id,body))setEditing(null);}}><textarea aria-label="메시지 수정" value={editing.body} maxLength={5000} rows={2} onChange={e=>setEditing({id:row.id,body:e.target.value})}/><div><button type="button" className="text-button" onClick={()=>setEditing(null)}>취소</button><button className="primary" disabled={busy||!editing.body.trim()}>저장</button></div></form>
                :<p className="chat-bubble" onContextMenu={e=>{e.preventDefault();e.stopPropagation();setMenu(row.id);}} onPointerDown={e=>{if(e.pointerType!=='mouse')startPress(row.id);}} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerMove={cancelPress}>{row.message.body}</p>)
              :row.type==='photos'?<div className={`photo-grid n${Math.min(row.files.length,4)}`}>{row.files.map(f=><button type="button" className="photo-cell" key={f.id} aria-label={`사진 ${f.name} 크게 보기`} onClick={()=>setViewer({file:f,url:null})}>{photos[f.path]?<img src={photos[f.path]} alt={f.name} loading="lazy"/>:<span>{f.name}</span>}</button>)}</div>
              :isAudio(row.file)?<div className="voice-bubble"><span>🎙 음성 메시지</span>{photos[row.file.path]?<audio controls preload="none" src={photos[row.file.path]}/>:<small className="muted">불러오는 중…</small>}</div>
              :<button className="chat-file" disabled={busy} onClick={()=>onFile(row.file)}><span>↧ {row.file.name}</span></button>}
              <time dateTime={row.time}>{readMark&&<b className="read-mark">{readMark}</b>}{row.type==='pending'?(row.pending.failed?'전송 실패':'전송 중…'):clock(row.time)}{row.type==='message'&&row.message.edited_at?' · 수정됨':''}</time>
            </div>
            {chips.length>0&&<div className="reaction-chips">{chips.map(([emoji,v])=><button type="button" key={emoji} className={v.mine?'mine':''} aria-pressed={v.mine} disabled={busy||!onReact} onClick={()=>onReact?.(row.id,emoji)}>{emoji} {v.count}</button>)}</div>}
            {row.type==='pending'&&row.pending.failed&&<span className="chat-tools"><button type="button" className="link-button" disabled={busy} onClick={()=>{setPending(p=>p.filter(x=>x.id!==row.id));void sendBody(row.pending.body,row.pending.replyTo);}}>다시 보내기</button><button type="button" className="link-button" onClick={()=>setPending(p=>p.filter(x=>x.id!==row.id))}>지우기</button></span>}
            {row.type==='message'&&row.message.shared_entry_id&&(()=>{const e=entries.find(e=>e.id===row.message.shared_entry_id);return e?<button className="shared-work" onClick={()=>onOpen(e,row.message.shared_occurrence || e.date)}>↗ {e.title}<small>{row.message.shared_occurrence} · 우리집 일 열기</small></button>:<small>연결된 일을 찾을 수 없어요.</small>;})()}
            {row.type==='message'&&menu===row.id&&<div className="chat-menu" role="menu" onClick={e=>e.stopPropagation()}>
              {onReact&&<div className="menu-emoji">{REACTION_EMOJI.map(e=><button type="button" key={e} role="menuitem" aria-label={`${e} 반응`} disabled={busy} onClick={()=>{onReact(row.id,e);setMenu(null);}}>{e}</button>)}</div>}
              <div className="menu-actions">
                {!closed&&<button type="button" role="menuitem" onClick={()=>{setReplyTo(row.message);setMenu(null);input.current?.focus();}}>답장</button>}
                <button type="button" role="menuitem" onClick={()=>{navigator.clipboard?.writeText(row.message.body).catch(()=>undefined);setMenu(null);}}>복사</button>
                {onPin&&(pin?.comment_id===row.id?<button type="button" role="menuitem" onClick={()=>{onUnpin?.();setMenu(null);}}>고정 해제</button>:<button type="button" role="menuitem" onClick={()=>{onPin(row.id);setMenu(null);}}>고정</button>)}
                {mine&&!closed&&<><button type="button" role="menuitem" disabled={busy} onClick={()=>{setEditing({id:row.id,body:row.message.body});setMenu(null);}}>수정</button><button type="button" role="menuitem" className="danger" disabled={busy} onClick={()=>{setMenu(null);if(window.confirm('이 메시지를 삭제할까요?'))onDelete(row.id);}}>삭제</button></>}
                <button type="button" role="menuitem" onClick={()=>setMenu(null)}>닫기</button>
              </div>
            </div>}
          </div>
        </Fragment>;})}
    </div>
    {fresh>0&&<button type="button" className="chat-fresh" onClick={jumpToBottom}>새 메시지 {fresh}개 ↓</button>}
    {closed
      ? <div className="room-closed" role="status"><p><b>종료된 대화예요.</b> {state?.purged_files?`사진·문서 ${state.purged_files}개(${formatBytes(state.purged_bytes)})는 정리했고 `:''}글은 그대로 남아 있어요. 다시 이야기할 일이면 새 일을 만들어 주세요.</p></div>
      : <form className="chat-compose" onSubmit={e=>{e.preventDefault();submit();}}>
          {replyTo&&<div className="reply-preview" role="status">↩ <b>{name(replyTo.created_by)}</b> {snippet(replyTo.body,70)}<button type="button" className="icon-button" aria-label="답장 취소" onClick={()=>setReplyTo(null)}>×</button></div>}
          {rec?<div className="voice-recording" role="status"><span className="rec-dot"/>녹음 중 {Math.floor(recSeconds/60)}:{String(recSeconds%60).padStart(2,'0')} · 최대 {MAX_VOICE_SECONDS}초<span className="rec-actions"><button type="button" className="text-button" onClick={()=>stopRecording(false)}>취소</button><button type="button" className="primary small" onClick={()=>stopRecording(true)}>보내기</button></span></div>
          :<div className="compose-row">
            <button type="button" className="icon-button attach" aria-label="사진·문서 첨부" title={`사진·문서 · 한 번에 ${MAX_FILES_PER_UPLOAD}장 · 파일당 10MB · 사진은 긴 변 1,600px으로 줄여 올려요`} disabled={busy} onClick={()=>fileInput.current?.click()}>＋</button>
            <input ref={fileInput} className="sr-only" aria-label="채팅 첨부파일" type="file" multiple disabled={busy} accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx" onChange={e=>{const files=Array.from(e.target.files ?? []);e.target.value='';if(files.length)onUpload(files.slice(0,MAX_FILES_PER_UPLOAD));}}/>
            <label className="sr-only" htmlFor="chat-message">메시지</label>
            <textarea id="chat-message" ref={input} rows={1} value={draft} maxLength={5000} placeholder={replyTo?'답장을 입력하세요':'메시지를 남겨주세요'} onChange={e=>{setDraft(e.target.value);autosize(e.target);}} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!coarse()){ e.preventDefault(); submit(); } if(e.key==='Escape'&&replyTo) setReplyTo(null); }}/>
            {draft.trim()||!canRecord?<button className="send" aria-label="보내기" disabled={busy||!draft.trim()}>↑</button>:<button type="button" className="send mic" aria-label="음성 메시지 녹음" disabled={busy} onClick={startRecording}>🎙</button>}
          </div>}
        </form>}
    {viewer&&<div className="photo-viewer" role="dialog" aria-label="사진 보기" onClick={()=>setViewer(null)} onTouchStart={e=>{touchX.current=e.touches[0].clientX;}} onTouchEnd={e=>{ if(touchX.current==null) return; const dx=e.changedTouches[0].clientX-touchX.current; touchX.current=null; if(Math.abs(dx)>50) stepViewer(dx<0?1:-1); }}>
      <div className="viewer-bar" onClick={e=>e.stopPropagation()}><span>{name(viewer.file.created_by)} · {viewer.file.created_at?`${dayLabel(viewer.file.created_at)} ${clock(viewer.file.created_at)}`:''} · {images.findIndex(f=>f.id===viewer.file.id)+1}/{images.length}</span><button type="button" className="text-button" onClick={()=>onFile(viewer.file)}>저장</button><button type="button" className="icon-button" aria-label="닫기" onClick={()=>setViewer(null)}>×</button></div>
      <img src={viewer.url||photos[viewer.file.path]} alt={viewer.file.name} onClick={e=>e.stopPropagation()}/>
      {images.length>1&&<><button type="button" className="viewer-nav prev" aria-label="이전 사진" onClick={e=>{e.stopPropagation();stepViewer(-1);}}>‹</button><button type="button" className="viewer-nav next" aria-label="다음 사진" onClick={e=>{e.stopPropagation();stepViewer(1);}}>›</button></>}
    </div>}
  </section>;
}
