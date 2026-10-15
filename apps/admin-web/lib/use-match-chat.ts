'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type MatchMessage = { id: string; sender_type: 'worker' | 'facility' | 'system'; sender_id: string | null; body: string; created_at: string };
const PAGE_SIZE = 100;
const clean = (error: unknown) => error instanceof Error ? error.message.replace(/^.*?: /, '') : '연결을 확인하고 다시 시도해 주세요.';

// Mirrored in both deployable apps; writes always use the database RPC.
export function useMatchChat(client: SupabaseClient, applicationId: string) {
  const [messages, setMessages] = useState<MatchMessage[]>([]), [input, setInput] = useState('');
  const [userId, setUserId] = useState(''), [open, setOpen] = useState(false), [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(''), [actionError, setActionError] = useState('');
  const [connectionIssue, setConnectionIssue] = useState(false), [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const sendLock = useRef(false), olderLock = useRef(false), sequence = useRef(0), route = useRef(applicationId);
  route.current = applicationId;
  const drafts = useRef(new Map<string, string>());
  const updateInput = (value: string) => { drafts.current.set(applicationId, value); setInput(value); };
  useEffect(() => { setInput(drafts.current.get(applicationId) ?? ''); setActionError(''); }, [applicationId]);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setLoadError(''); setOpen(false); setMessages([]); setHasMore(false);
    try {
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) throw new Error('로그인이 필요해요. 로그인한 뒤 대화를 다시 열어 주세요.');
      const [history, access] = await Promise.all([
        client.from('chat_messages').select('id,sender_type,sender_id,body,created_at').eq('application_id', applicationId)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE),
        client.rpc('chat_is_open', { p_application_id: applicationId }),
      ]);
      if (history.error || access.error || typeof access.data !== 'boolean') throw new Error('대화를 불러오지 못했어요. 다시 시도해 주세요.');
      if (request !== sequence.current) return;
      setUserId(user.id);
      setMessages(current => [...new Map([...current, ...((history.data ?? []) as MatchMessage[])].map(row => [row.id,row])).values()]
        .sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at) || a.id.localeCompare(b.id)));
      setHasMore((history.data?.length ?? 0) === PAGE_SIZE); setOpen(access.data);
    } catch (error) { if (request === sequence.current) setLoadError(clean(error)); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [applicationId, client]);
  useEffect(() => {
    let active = true;
    void load();
    const channel = client.channel(`chat-${applicationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `application_id=eq.${applicationId}` }, payload => {
        if (!active) return;
        const message = payload.new as MatchMessage;
        setMessages(current => current.some(row => row.id === message.id) ? current : [...current, message]);
      }).subscribe(status => { if (active) setConnectionIssue(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'); });
    return () => { active = false; sequence.current += 1; void client.removeChannel(channel); };
  }, [applicationId, client, load]);
  async function loadOlder() {
    if (olderLock.current || !hasMore || !messages[0]) return;
    olderLock.current = true; setLoadingOlder(true); setActionError('');
    const cursor = messages[0], room = applicationId;
    try {
      const { data, error } = await client.from('chat_messages').select('id,sender_type,sender_id,body,created_at')
        .eq('application_id', room).or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE);
      if (error) throw new Error('이전 대화를 불러오지 못했어요. 다시 시도해 주세요.');
      if (route.current !== room) return;
      const rows = ((data ?? []) as MatchMessage[]).reverse();
      setMessages(current => [...rows.filter(row => !current.some(existing => existing.id === row.id)), ...current]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (error) { if (route.current === room) setActionError(clean(error)); }
    finally { olderLock.current = false; setLoadingOlder(false); }
  }
  async function send() {
    const draft = input, body = draft.trim(), room = applicationId;
    if (!body || sendLock.current || !open || loading || loadError) return false;
    sendLock.current = true; setSending(true); setActionError('');
    try {
      const { data, error } = await client.rpc('send_chat_message', { p_application_id: room, p_body: body });
      if (error) throw new Error(error.message);
      if (!data || typeof data.id !== 'string') throw new Error('전송 결과를 확인하지 못했어요. 대화를 다시 불러와 확인해 주세요.');
      if (drafts.current.get(room) === draft) drafts.current.delete(room);
      if (route.current === room) {
        setInput(current => current === draft ? '' : current);
        setMessages(current => current.some(row => row.id === data.id) ? current : [...current, data as MatchMessage]);
      }
      return true;
    } catch (error) { if (route.current === room) setActionError(clean(error)); return false; }
    finally { sendLock.current = false; setSending(false); }
  }
  return { messages, input, setInput: updateInput, userId, open, loading, loadError, actionError, connectionIssue, sending, hasMore, loadingOlder, load, loadOlder, send };
}
