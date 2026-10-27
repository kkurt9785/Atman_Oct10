'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Attachment, Comment, Entry, RoomState } from '../lib/model';
import { Room } from '../lib/work';
import { useSignedPhotos } from '../lib/chat';
import { formatBytes } from '../lib/image';

export const MAX_FILES_PER_UPLOAD = 10;
const GROUP_GAP = 5 * 60 * 1000; // consecutive messages by the same person within 5 minutes share one header
type Pending = { id: string; body: string; time: string; failed: boolean };
type Row = { type: 'message'; id: string; time: string; message: Comment } | { type: 'file'; id: string; time: string; file: Attachment } | { type: 'pending'; id: string; time: string; pending: Pending };

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
const authorOf = (row: Row, uid: string) => row.type === 'message' ? row.message.created_by : row.type === 'file' ? row.file.created_by : uid;

export function Chat({room,state,comments,attachments,entries,uid,name,busy,sync,hasMore,loadingOlder,loadError,onOlder,onSend,onEdit,onDelete,onUpload,onFile,onOpen,onClose,onReopen,unreadCount=0}: {
  room:Room;state?:RoomState;comments:Comment[];attachments:Attachment[];entries:Entry[];uid:string;name:(id:string)=>string;busy:boolean;sync:string;
  hasMore:boolean;loadingOlder:boolean;loadError:string;onOlder:()=>void;
  onSend:(body:string)=>Promise<boolean>;onEdit:(id:string,body:string)=>Promise<boolean>;onDelete:(id:string)=>void;onUpload:(files:File[])=>void;onFile:(file:Attachment)=>void;onOpen:(entry:Entry,date:string)=>void;
  onClose?:()=>void;onReopen?:()=>void;unreadCount?:number;
}) {
  const [draft,setDraft]=useState('');
  const [pending,setPending]=useState<Pending[]>([]);
  const [editing,setEditing]=useState<{id:string;body:string}|null>(null);
  const [menu,setMenu]=useState<string|null>(null); // message whose long-press / right-click menu is open
  const [fresh,setFresh]=useState(0); // messages that arrived while the reader was scrolled up
  const list=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const divider=useRef<HTMLDivElement>(null);
  const nearBottom=useRef(true);
  const keepOffset=useRef<number|null>(null);
  const positioned=useRef(false);
  const pressTimer=useRef<number|null>(null);
  const initialUnread=useRef(unreadCount); // where the "read up to here" line goes; fixed when the room opens
  const photos=useSignedPhotos(attachments);
  const closed=!!state?.closed_at;

  // A pending bubble disappears as soon as the real row arrives (same author, same text, within two minutes).
  useEffect(()=>{ if(pending.length) setPending(p=>p.filter(x=>x.failed||!comments.some(c=>c.created_by===uid&&c.body===x.body&&Math.abs(new Date(c.created_at).getTime()-new Date(x.time).getTime())<120000))); },[comments]); // eslint-disable-line react-hooks/exhaustive-deps
  const timeline:Row[]=[...comments.map(m=>({type:'message' as const,id:m.id,time:m.created_at,message:m})),...attachments.map(f=>({type:'file' as const,id:f.id,time:f.created_at || '',file:f})),...pending.map(p=>({type:'pending' as const,id:p.id,time:p.time,pending:p}))].sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
  const last=timeline.at(-1)?.id;
  const first=timeline[0]?.id;
  const othersIdx=timeline.flatMap((r,i)=>r.type!=='pending'&&authorOf(r,uid)!==uid?[i]:[]);
  const unreadStart=initialUnread.current>0&&othersIdx.length?othersIdx[Math.max(0,othersIdx.length-initialUnread.current)]:-1;
  // Older pages are inserted above; keep what the reader was looking at in place.
  useLayoutEffect(()=>{const el=list.current;if(!el)return;if(keepOffset.current!=null){el.scrollTop=el.scrollHeight-keepOffset.current;keepOffset.current=null;}},[first]);
  // First paint: land on the unread line if there is one, otherwise at the bottom.
  useLayoutEffect(()=>{ if(positioned.current||!timeline.length) return; positioned.current=true; const el=list.current; if(!el) return; if(divider.current){ el.scrollTop=Math.max(0,divider.current.offsetTop-40); nearBottom.current=false; } else el.scrollTop=el.scrollHeight; },[timeline.length]);
  useLayoutEffect(()=>{ const el=list.current; if(!el||!positioned.current||keepOffset.current!=null) return; if(nearBottom.current){ el.scrollTop=el.scrollHeight; setFresh(0); } else setFresh(n=>n+1); },[last]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!menu) return; const close=()=>setMenu(null); document.addEventListener('click',close); document.addEventListener('keydown',close); return ()=>{ document.removeEventListener('click',close); document.removeEventListener('keydown',close); }; },[menu]);

  const autosize=(el:HTMLTextAreaElement)=>{ el.style.height='auto'; el.style.height=`${Math.min(el.scrollHeight,140)}px`; };
  async function sendBody(body:string){
    const row:Pending={id:`p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,body,time:new Date().toISOString(),failed:false};
    setPending(p=>[...p,row]); nearBottom.current=true;
    const ok=await onSend(body);
    if(!ok) setPending(p=>p.map(x=>x.id===row.id?{...x,failed:true}:x));
  }
  function submit(){ const body=draft.trim(); if(!body||busy) return; setDraft(''); if(input.current){ input.current.style.height='auto'; } void sendBody(body); }
  const startPress=(id:string)=>{ if(pressTimer.current) window.clearTimeout(pressTimer.current); pressTimer.current=window.setTimeout(()=>setMenu(id),500); };
  const cancelPress=()=>{ if(pressTimer.current){ window.clearTimeout(pressTimer.current); pressTimer.current=null; } };
  const jumpToBottom=()=>{ const el=list.current; if(el) el.scrollTop=el.scrollHeight; nearBottom.current=true; setFresh(0); };

  return <section className="chat-room" aria-label={room?'이 일의 대화':'가족 기본 채팅'}>
    <div className="section-head chat-head"><h3>{room?'이 일의 대화':'가족 기본 채팅'}{closed&&<span className="room-closed-badge">종료됨</span>}</h3><small className="muted" role="status">{sync}</small>{room&&onClose&&!closed&&<button type="button" className="text-button" disabled={busy} onClick={onClose}>대화 종료</button>}</div>
    <div className="chat-messages" ref={list} role="log" aria-label="대화 내역" aria-live="polite" onScroll={()=>{const el=list.current!;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;if(nearBottom.current)setFresh(0);}}>
      {hasMore&&<button className="secondary chat-older" disabled={loadingOlder} onClick={()=>{const el=list.current;if(el)keepOffset.current=el.scrollHeight-el.scrollTop;onOlder();}}>{loadingOlder?'불러오는 중…':'이전 대화 보기'}</button>}
      {loadError&&<p role="alert" className="error banner">{loadError}</p>}
      {!timeline.length&&!loadingOlder&&<div className="empty">{closed?'종료된 대화예요.':room?'사진과 의견을 남겨 함께 결정해 보세요.':'일상 이야기는 여기서 편하게 나눠요.'}</div>}
      {timeline.map((row,i)=>{
        const author=authorOf(row,uid); const mine=author===uid; const prev=timeline[i-1];
        const newDay=!prev||dayKey(prev.time)!==dayKey(row.time);
        const grouped=!newDay&&!!prev&&authorOf(prev,uid)===author&&new Date(row.time).getTime()-new Date(prev.time).getTime()<GROUP_GAP&&i!==unreadStart;
        return <Fragment key={row.id}>
          {newDay&&<div className="chat-date" role="separator">{dayLabel(row.time)}</div>}
          {i===unreadStart&&<div className="chat-unread" ref={divider} role="separator">여기까지 읽었어요</div>}
          <div className={`chat-line ${mine?'mine':''} ${grouped?'grouped':''}`}>
            {!mine&&!grouped&&<small className="chat-author">{name(author)}</small>}
            <div className="bubble-row">
              {row.type==='pending'?<p className="chat-bubble pending">{row.pending.body}</p>
              :row.type==='message'?(editing?.id===row.id
                ?<form className="chat-edit" onSubmit={async e=>{e.preventDefault();const body=editing.body.trim();if(!body)return;if(await onEdit(row.id,body))setEditing(null);}}><textarea aria-label="메시지 수정" value={editing.body} maxLength={5000} rows={2} onChange={e=>setEditing({id:row.id,body:e.target.value})}/><div><button type="button" className="text-button" onClick={()=>setEditing(null)}>취소</button><button className="primary" disabled={busy||!editing.body.trim()}>저장</button></div></form>
                :<p className="chat-bubble" onContextMenu={e=>{e.preventDefault();e.stopPropagation();setMenu(row.id);}} onPointerDown={e=>{if(e.pointerType!=='mouse')startPress(row.id);}} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerMove={cancelPress}>{row.message.body}</p>)
              :<button className="chat-file" disabled={busy} onClick={()=>onFile(row.file)}>{photos[row.file.path]&&<img className="chat-photo" src={photos[row.file.path]} alt={row.file.name} loading="lazy"/>}<span>↧ {row.file.name}</span></button>}
              <time dateTime={row.time}>{row.type==='pending'?(row.pending.failed?'전송 실패':'전송 중…'):clock(row.time)}{row.type==='message'&&row.message.edited_at?' · 수정됨':''}</time>
            </div>
            {row.type==='pending'&&row.pending.failed&&<span className="chat-tools"><button type="button" className="link-button" disabled={busy} onClick={()=>{setPending(p=>p.filter(x=>x.id!==row.id));void sendBody(row.pending.body);}}>다시 보내기</button><button type="button" className="link-button" onClick={()=>setPending(p=>p.filter(x=>x.id!==row.id))}>지우기</button></span>}
            {row.type==='message'&&row.message.shared_entry_id&&(()=>{const e=entries.find(e=>e.id===row.message.shared_entry_id);return e?<button className="shared-work" onClick={()=>onOpen(e,row.message.shared_occurrence || e.date)}>↗ {e.title}<small>{row.message.shared_occurrence} · 우리집 일 열기</small></button>:<small>연결된 일을 찾을 수 없어요.</small>;})()}
            {row.type==='message'&&menu===row.id&&<div className="chat-menu" role="menu" onClick={e=>e.stopPropagation()}>
              <button type="button" role="menuitem" onClick={()=>{navigator.clipboard?.writeText(row.message.body).catch(()=>undefined);setMenu(null);}}>복사</button>
              {mine&&!closed&&<><button type="button" role="menuitem" disabled={busy} onClick={()=>{setEditing({id:row.id,body:row.message.body});setMenu(null);}}>수정</button><button type="button" role="menuitem" className="danger" disabled={busy} onClick={()=>{setMenu(null);if(window.confirm('이 메시지를 삭제할까요?'))onDelete(row.id);}}>삭제</button></>}
              <button type="button" role="menuitem" onClick={()=>setMenu(null)}>닫기</button>
            </div>}
          </div>
        </Fragment>;})}
    </div>
    {fresh>0&&<button type="button" className="chat-fresh" onClick={jumpToBottom}>새 메시지 {fresh}개 ↓</button>}
    {closed
      ? <div className="room-closed" role="status"><p><b>종료된 대화예요.</b> {state?.purged_files?`사진·문서 ${state.purged_files}개(${formatBytes(state.purged_bytes)})는 정리했고 `:''}글은 그대로 남아 있어요.</p>{onReopen&&<button className="secondary" disabled={busy} onClick={onReopen}>다시 열기</button>}</div>
      : <form className="chat-compose" onSubmit={e=>{e.preventDefault();submit();}}>
          <button type="button" className="icon-button attach" aria-label="사진·문서 첨부" title={`사진·문서 · 한 번에 ${MAX_FILES_PER_UPLOAD}장 · 파일당 10MB · 사진은 긴 변 1,600px으로 줄여 올려요`} disabled={busy} onClick={()=>fileInput.current?.click()}>＋</button>
          <input ref={fileInput} className="sr-only" aria-label="채팅 첨부파일" type="file" multiple disabled={busy} accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx" onChange={e=>{const files=Array.from(e.target.files ?? []);e.target.value='';if(files.length)onUpload(files.slice(0,MAX_FILES_PER_UPLOAD));}}/>
          <label className="sr-only" htmlFor="chat-message">메시지</label>
          <textarea id="chat-message" ref={input} rows={1} value={draft} maxLength={5000} placeholder="메시지를 남겨주세요" onChange={e=>{setDraft(e.target.value);autosize(e.target);}} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!coarse()){ e.preventDefault(); submit(); } }}/>
          <button className="send" aria-label="보내기" disabled={busy||!draft.trim()}>↑</button>
        </form>}
  </section>;
}
