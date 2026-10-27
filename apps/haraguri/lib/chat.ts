'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment, Comment, Pin, Reaction, RoomRead } from './model';
import { supabase } from './supabase';
import { Room, inRoom } from './work';
import { thumbPath } from './image';

// Every file in a room, for cleanup when the room closes (not page-limited).
export async function listRoomFiles(familyId: string, room: Exclude<Room, null>) {
  const files: { id: string; path: string; size: number }[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const r = await supabase!.from('hg_attachments').select('id,path,size').eq('family_id', familyId).eq('entry_id', room.entry.id).eq('occurrence', room.date).order('id').range(offset, offset + 499);
    if (r.error) throw r.error;
    files.push(...(r.data as typeof files));
    if ((r.data?.length ?? 0) < 500) break;
  }
  return files;
}

// Rooms are loaded a page at a time so a family's chat history never hits the table-wide row cap.
export const PAGE = 100;
export type RoomKey = { entry_id: string | null; occurrence: string | null };
export type DemoChat = { comments: Comment[]; attachments: Attachment[] };

export function roomKey(room: Room): RoomKey {
  return { entry_id: room?.entry.id ?? null, occurrence: room?.date ?? null };
}
// Newest page and realtime refreshes overlap with what is already shown; keep one copy, oldest first.
export function mergeById<T extends { id: string; created_at?: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));
}
export function olderCursor(items: { created_at?: string }[]): string | null {
  const times = items.map(i => i.created_at).filter((t): t is string => !!t);
  return times.length ? times.reduce((min, t) => (t < min ? t : min)) : null;
}

type Page = { comments: Comment[]; attachments: Attachment[] };
async function fetchPage(familyId: string, key: RoomKey, before: string | null): Promise<Page> {
  const build = (table: string) => {
    let q = supabase!.from(table).select('*').eq('family_id', familyId);
    q = key.entry_id ? q.eq('entry_id', key.entry_id).eq('occurrence', key.occurrence!) : q.is('entry_id', null);
    if (before) q = q.lt('created_at', before);
    return q.order('created_at', { ascending: false }).limit(PAGE);
  };
  const [comments, attachments] = await Promise.all([build('hg_comments'), build('hg_attachments')]);
  if (comments.error) throw comments.error;
  if (attachments.error) throw attachments.error;
  return { comments: comments.data as Comment[], attachments: attachments.data as Attachment[] };
}

export function useRoomMessages({ familyId, room, demo, demoChat, version, enabled = true }: {
  familyId: string; room: Room; demo: boolean; demoChat: DemoChat; version: number; enabled?: boolean;
}) {
  const key = roomKey(room);
  const id = `${familyId}|${key.entry_id}|${key.occurrence}`;
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(id);
  const reachedStart = useRef(false);

  useEffect(() => {
    current.current = id;
    reachedStart.current = false;
    if (!enabled || !familyId) { setComments([]); setAttachments([]); setHasMore(false); setError(''); return; }
    if (demo || !supabase) {
      setComments(demoChat.comments.filter(c => inRoom(c, room)));
      setAttachments(demoChat.attachments.filter(f => inRoom(f, room)));
      setHasMore(false);
      return;
    }
    let active = true;
    setLoading(true); setError('');
    fetchPage(familyId, key, null).then(page => {
      if (!active || current.current !== id) return;
      // A refresh keeps older pages the reader already scrolled to.
      setComments(prev => mergeById(prev.filter(c => inRoom(c, room)), page.comments));
      setAttachments(prev => mergeById(prev.filter(f => inRoom(f, room)), page.attachments));
      if (!reachedStart.current) setHasMore(page.comments.length === PAGE || page.attachments.length === PAGE);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version, demo, demoChat, enabled]);

  const loadOlder = useCallback(async () => {
    if (demo || !supabase || loading) return;
    const before = olderCursor([...comments, ...attachments]);
    if (!before) { setHasMore(false); return; }
    setLoading(true); setError('');
    try {
      const page = await fetchPage(familyId, key, before);
      if (current.current !== id) return;
      setComments(prev => mergeById(prev, page.comments));
      setAttachments(prev => mergeById(prev, page.attachments));
      const more = page.comments.length === PAGE || page.attachments.length === PAGE;
      reachedStart.current = !more;
      setHasMore(more);
    } catch (e) { setError(e instanceof Error ? e.message : '이전 대화를 불러오지 못했어요.'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, loading, comments, attachments, familyId, id]);

  return { comments, attachments, hasMore, loading, error, loadOlder };
}

// One signed-URL request per page of photos instead of one per image. Thumbnails first; full photos only where no thumbnail exists (older uploads).
export function useSignedPhotos(files: Attachment[]) {
  const paths = files.filter(f => /\.(png|jpe?g|webp|webm|m4a|mp4|mp3|ogg|aac)$/i.test(f.path)).map(f => f.path).sort(); // photos get thumbnails; audio falls through to the full signed URL
  const keyOf = paths.join('\n');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!supabase || !paths.length) { setUrls({}); return; }
    let active = true;
    const refresh = async () => {
      const bucket = supabase!.storage.from('haraguri-files');
      const thumbs = await bucket.createSignedUrls(paths.map(thumbPath), 600);
      const signed: Record<string, string> = {};
      const missing: string[] = [];
      paths.forEach((path, i) => { const hit = thumbs.data?.[i]; if (hit?.signedUrl && !hit.error) signed[path] = hit.signedUrl; else missing.push(path); });
      if (missing.length) {
        const full = await bucket.createSignedUrls(missing, 600);
        missing.forEach((path, i) => { const hit = full.data?.[i]; if (hit?.signedUrl && !hit.error) signed[path] = hit.signedUrl; });
      }
      if (active) setUrls(signed);
    };
    refresh();
    const timer = setInterval(refresh, 300000);
    return () => { active = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyOf]);
  return urls;
}

export type SearchHit = { id: string; body: string; created_by: string; created_at: string; entry_id: string | null; occurrence: string | null; room_title: string };
export type SocialState = { reactions: Reaction[]; reads: RoomRead[]; pin: (Pin & { comment: Comment | null }) | null };
export const emptySocial: SocialState = { reactions: [], reads: [], pin: null };
// Reactions for the loaded page, everyone's last-read time in this room, and the room's pinned notice. Refetched on the same version bumps as messages.
export function useRoomSocial({ familyId, room, commentIds, demo, version, enabled = true }: { familyId: string; room: Room; commentIds: string[]; demo: boolean; version: number; enabled?: boolean }) {
  const key = roomKey(room);
  const idsKey = commentIds.join(',');
  const [state, setState] = useState<SocialState>(emptySocial);
  useEffect(() => {
    if (!enabled || demo || !supabase || !familyId) { setState(emptySocial); return; }
    let active = true;
    (async () => {
      const ids = idsKey ? idsKey.split(',') : [];
      const readsQ = supabase!.from('hg_room_reads').select('user_id,last_read_at').eq('family_id', familyId);
      const pinsQ = supabase!.from('hg_pins').select('comment_id,pinned_by,pinned_at').eq('family_id', familyId);
      const [reactions, reads, pins] = await Promise.all([
        ids.length ? supabase!.from('hg_reactions').select('id,comment_id,user_id,emoji').in('comment_id', ids) : Promise.resolve({ data: [] as Reaction[], error: null }),
        key.entry_id ? readsQ.eq('entry_id', key.entry_id).eq('occurrence', key.occurrence!) : readsQ.is('entry_id', null).is('occurrence', null),
        key.entry_id ? pinsQ.eq('entry_id', key.entry_id).eq('occurrence', key.occurrence!) : pinsQ.is('entry_id', null).is('occurrence', null),
      ]);
      const pinRow = (pins.data as Pin[] | null)?.[0] ?? null;
      let comment: Comment | null = null;
      if (pinRow) { const r = await supabase!.from('hg_comments').select('*').eq('id', pinRow.comment_id).maybeSingle(); comment = (r.data as Comment | null) ?? null; }
      if (!active) return;
      setState({ reactions: (reactions.data as Reaction[] | null) ?? [], reads: (reads.data as RoomRead[] | null) ?? [], pin: pinRow ? { ...pinRow, comment } : null });
    })().catch(() => { if (active) setState(emptySocial); });
    return () => { active = false; };
  }, [familyId, key.entry_id, key.occurrence, idsKey, version, demo, enabled]);
  return state;
}
