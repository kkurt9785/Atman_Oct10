'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Attachment, Comment, Entry, RoomState } from '../lib/model';
import { Room } from '../lib/work';
import { useSignedPhotos } from '../lib/chat';
import { formatBytes } from '../lib/image';

export const MAX_FILES_PER_UPLOAD = 10;

export function Chat({room,state,comments,attachments,entries,uid,name,busy,sync,hasMore,loadingOlder,loadError,onOlder,onSend,onEdit,onDelete,onUpload,onFile,onOpen,onClose,onReopen}: {
  room:Room;state?:RoomState;comments:Comment[];attachments:Attachment[];entries:Entry[];uid:string;name:(id:string)=>string;busy:boolean;sync:string;
  hasMore:boolean;loadingOlder:boolean;loadError:string;onOlder:()=>void;
  onSend:(body:string)=>Promise<boolean>;onEdit:(id:string,body:string)=>Promise<boolean>;onDelete:(id:string)=>void;onUpload:(files:File[])=>void;onFile:(file:Attachment)=>void;onOpen:(entry:Entry,date:string)=>void;
  onClose?:()=>void;onReopen?:()=>void;
}) {
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);
  const [editing,setEditing]=useState<{id:string;body:string}|null>(null);
  const list=useRef<HTMLDivElement>(null);
  const nearBottom=useRef(true);
  const keepOffset=useRef<number|null>(null);
  const photos=useSignedPhotos(attachments);
  const closed=!!state?.closed_at;
  const timeline=[...comments.map(m=>({type:'message' as const,id:m.id,time:m.created_at,message:m})),...attachments.map(f=>({type:'file' as const,id:f.id,time:f.created_at || '',file:f}))].sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
  const last=timeline.at(-1)?.id;
  const first=timeline[0]?.id;
  // Older pages are inserted above; keep what the reader was looking at in place.
  useLayoutEffect(()=>{const el=list.current;if(!el)return;if(keepOffset.current!=null){el.scrollTop=el.scrollHeight-keepOffset.current;keepOffset.current=null;}},[first]);
  useLayoutEffect(()=>{if(nearBottom.current&&list.current&&keepOffset.current==null)list.current.scrollTop=list.current.scrollHeight;},[last]);
  return <section className="chat-room" aria-label={room?'이 일의 대화':'가족 기본 채팅'}>
    <div className="section-head"><h3>{room?'이 일의 대화':'가족 기본 채팅'}{closed&&<span className="room-closed-badge">종료됨</span>}</h3><small className="muted" role="status">{sync}</small></div>
    <div className="chat-messages" ref={list} role="log" aria-label="대화 내역" aria-live="polite" onScroll={()=>{const el=list.current!;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
      {hasMore&&<button className="secondary chat-older" disabled={loadingOlder} onClick={()=>{const el=list.current;if(el)keepOffset.current=el.scrollHeight-el.scrollTop;onOlder();}}>{loadingOlder?'불러오는 중…':'이전 대화 보기'}</button>}
      {loadError&&<p role="alert" className="error banner">{loadError}</p>}
      {!timeline.length&&!loadingOlder&&<div className="empty">{closed?'종료된 대화예요.':room?'사진과 의견을 남겨 함께 결정해 보세요.':'일상 이야기는 여기서 편하게 나눠요.'}</div>}
      {timeline.map(row=>{const author=row.type==='message'?row.message.created_by:row.file.created_by;const mine=author===uid;return <div className={`chat-line ${mine?'mine':''}`} key={row.id}><small>{name(author)}{row.time&&` · ${new Date(row.time).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`}{row.type==='message'&&row.message.edited_at&&' · 수정됨'}</small>
        {row.type==='message'?(editing?.id===row.id
          ?<form className="chat-edit" onSubmit={async e=>{e.preventDefault();const body=editing.body.trim();if(!body)return;if(await onEdit(row.id,body))setEditing(null);}}><textarea aria-label="메시지 수정" value={editing.body} maxLength={5000} rows={2} onChange={e=>setEditing({id:row.id,body:e.target.value})}/><div><button type="button" className="text-button" onClick={()=>setEditing(null)}>취소</button><button className="primary" disabled={busy||!editing.body.trim()}>저장</button></div></form>
          :<><p className="chat-bubble">{row.message.body}</p>{row.message.shared_entry_id&&(()=>{const e=entries.find(e=>e.id===row.message.shared_entry_id);return e?<button className="shared-work" onClick={()=>onOpen(e,row.message.shared_occurrence || e.date)}>↗ {e.title}<small>{row.message.shared_occurrence} · 우리집 일 열기</small></button>:<small>연결된 일을 찾을 수 없어요.</small>;})()}
            {mine&&!closed&&<span className="chat-tools"><button type="button" className="link-button" disabled={busy} onClick={()=>setEditing({id:row.id,body:row.message.body})}>수정</button><button type="button" className="link-button" disabled={busy} onClick={()=>{if(window.confirm('이 메시지를 삭제할까요?'))onDelete(row.id);}}>삭제</button></span>}</>)
          :<button className="chat-file" disabled={busy} onClick={()=>onFile(row.file)}>{photos[row.file.path]&&<img className="chat-photo" src={photos[row.file.path]} alt={row.file.name} loading="lazy"/>}<span>↧ {row.file.name}</span></button>}
      </div>;})}
    </div>
    {closed
      ? <div className="room-closed" role="status"><p><b>종료된 대화예요.</b> {state?.purged_files?`사진·문서 ${state.purged_files}개(${formatBytes(state.purged_bytes)})는 정리했고 `:''}글은 그대로 남아 있어요.</p>{onReopen&&<button className="secondary" disabled={busy} onClick={onReopen}>다시 열기</button>}</div>
      : <form className="chat-compose" onSubmit={async e=>{e.preventDefault();const body=draft.trim();if(!body||sending)return;setSending(true);try{if(await onSend(body)){setDraft('');nearBottom.current=true;}}finally{setSending(false);}}}>
          <label className="sr-only" htmlFor="chat-message">메시지</label><textarea id="chat-message" value={draft} onChange={e=>setDraft(e.target.value)} required maxLength={5000} rows={2} placeholder="메시지를 남겨주세요"/>
          <div><label className="chat-upload">＋ 사진·문서<input aria-label="채팅 첨부파일" type="file" multiple disabled={busy||sending} accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx" onChange={e=>{const files=Array.from(e.target.files ?? []);e.target.value='';if(files.length)onUpload(files.slice(0,MAX_FILES_PER_UPLOAD));}}/></label><button className="primary" disabled={busy||sending||!draft.trim()}>{sending?'전송 중…':'보내기'}</button></div>
          <small className="muted">가족에게만 공유 · 사진은 긴 변 1,600px으로 줄여 올려요 · 한 번에 {MAX_FILES_PER_UPLOAD}장 · 파일당 10MB{room&&onClose&&<> · <button type="button" className="link-button" disabled={busy} onClick={onClose}>대화 종료</button></>}</small>
        </form>}
  </section>;
}
