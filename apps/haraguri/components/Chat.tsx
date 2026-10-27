'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Attachment, Comment, Entry } from '../lib/model';
import { Room } from '../lib/work';
import { useSignedPhotos } from '../lib/chat';

export function Chat({room,comments,attachments,entries,uid,name,busy,sync,hasMore,loadingOlder,loadError,onOlder,onSend,onUpload,onFile,onOpen}: {
  room:Room;comments:Comment[];attachments:Attachment[];entries:Entry[];uid:string;name:(id:string)=>string;busy:boolean;sync:string;
  hasMore:boolean;loadingOlder:boolean;loadError:string;onOlder:()=>void;
  onSend:(body:string)=>Promise<boolean>;onUpload:(file:File)=>void;onFile:(file:Attachment)=>void;onOpen:(entry:Entry,date:string)=>void;
}) {
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);
  const list=useRef<HTMLDivElement>(null);
  const nearBottom=useRef(true);
  const keepOffset=useRef<number|null>(null);
  const photos=useSignedPhotos(attachments);
  const timeline=[...comments.map(m=>({type:'message' as const,id:m.id,time:m.created_at,message:m})),...attachments.map(f=>({type:'file' as const,id:f.id,time:f.created_at || '',file:f}))].sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
  const last=timeline.at(-1)?.id;
  const first=timeline[0]?.id;
  // Older pages are inserted above; keep what the reader was looking at in place.
  useLayoutEffect(()=>{const el=list.current;if(!el)return;if(keepOffset.current!=null){el.scrollTop=el.scrollHeight-keepOffset.current;keepOffset.current=null;}},[first]);
  useLayoutEffect(()=>{if(nearBottom.current&&list.current&&keepOffset.current==null)list.current.scrollTop=list.current.scrollHeight;},[last]);
  return <section className="chat-room" aria-label={room?'이 일의 대화':'가족 기본 채팅'}>
    <div className="section-head"><h3>{room?'이 일의 대화':'가족 기본 채팅'}</h3><small className="muted" role="status">{sync}</small></div>
    <div className="chat-messages" ref={list} role="log" aria-label="대화 내역" aria-live="polite" onScroll={()=>{const el=list.current!;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
      {hasMore&&<button className="secondary chat-older" disabled={loadingOlder} onClick={()=>{const el=list.current;if(el)keepOffset.current=el.scrollHeight-el.scrollTop;onOlder();}}>{loadingOlder?'불러오는 중…':'이전 대화 보기'}</button>}
      {loadError&&<p role="alert" className="error banner">{loadError}</p>}
      {!timeline.length&&!loadingOlder&&<div className="empty">{room?'사진과 의견을 남겨 함께 결정해 보세요.':'일상 이야기는 여기서 편하게 나눠요.'}</div>}
      {timeline.map(row=>{const author=row.type==='message'?row.message.created_by:row.file.created_by;return <div className={`chat-line ${author===uid?'mine':''}`} key={row.id}><small>{name(author)}{row.time&&` · ${new Date(row.time).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`}</small>
        {row.type==='message'?<><p className="chat-bubble">{row.message.body}</p>{row.message.shared_entry_id&&(()=>{const e=entries.find(e=>e.id===row.message.shared_entry_id);return e?<button className="shared-work" onClick={()=>onOpen(e,row.message.shared_occurrence || e.date)}>↗ {e.title}<small>{row.message.shared_occurrence} · 우리집 일 열기</small></button>:<small>연결된 일을 찾을 수 없어요.</small>;})()}</>:<button className="chat-file" disabled={busy} onClick={()=>onFile(row.file)}>{photos[row.file.path]&&<img className="chat-photo" src={photos[row.file.path]} alt={row.file.name} loading="lazy"/>}<span>↧ {row.file.name}</span></button>}
      </div>;})}
    </div>
    <form className="chat-compose" onSubmit={async e=>{e.preventDefault();const body=draft.trim();if(!body||sending)return;setSending(true);try{if(await onSend(body)){setDraft('');nearBottom.current=true;}}finally{setSending(false);}}}>
      <label className="sr-only" htmlFor="chat-message">메시지</label><textarea id="chat-message" value={draft} onChange={e=>setDraft(e.target.value)} required maxLength={5000} rows={2} placeholder="메시지를 남겨주세요"/>
      <div><label className="chat-upload">＋ 사진·문서<input aria-label="채팅 첨부파일" type="file" disabled={busy||sending} accept="image/jpeg,image/png,image/webp,.pdf,.txt,.docx,.xlsx" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onUpload(file);}}/></label><button className="primary" disabled={busy||sending||!draft.trim()}>{sending?'전송 중…':'보내기'}</button></div>
      <small className="muted">가족에게만 공유 · 사진은 긴 변 1,600px으로 줄여 올려요 · 파일당 10MB · 앱을 닫았을 때의 푸시 알림은 아직 제공하지 않아요.</small>
    </form>
  </section>;
}
