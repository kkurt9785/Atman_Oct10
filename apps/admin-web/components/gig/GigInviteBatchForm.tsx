'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyInviteButton } from '@/app/staff/CopyInviteButton';
import { runGigProjectAction, type GigInviteBatch } from '@/lib/actions/gig-projects';
import { GIG_INVITE_BATCH_MAX, parseInviteLines, type GigInvitePerson } from '@/lib/gig-invite-lines';

type Row = GigInvitePerson & { key: number };

// 근무 건에 새 사람을 초대한다. 한 명이면 예전처럼 이름만 쓰고 누르면 되고, 여러 명이면 '+ 한 명 더'·엔터·명단 붙여넣기로 줄을 늘려 한 번에 등록한다.
// 초대 링크는 사람마다 따로(일회용·본인용)라 결과도 사람마다 보내기 버튼을 둔다. 등록하지 못한 사람은 이유와 함께 알려 주고 입력칸에 남긴다.
export function GigInviteBatchForm({ projectId, workerOrigin }: { projectId: string; workerOrigin: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const nextKey = useRef(1);
  const focusKey = useRef<number | null>(null);
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});
  const [rows, setRows] = useState<Row[]>([{ key: 0, name: '', phone: '' }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<GigInviteBatch | null>(null);

  const filled = rows.filter((row) => row.name.trim()).length;
  const many = rows.length > 1;
  const make = (person: GigInvitePerson): Row => ({ ...person, key: nextKey.current++ });
  const update = (key: number, patch: Partial<GigInvitePerson>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  function addRow() {
    if (rows.length >= GIG_INVITE_BATCH_MAX) return;
    const row = make({ name: '', phone: '' });
    focusKey.current = row.key;
    setRows([...rows, row]);
  }

  function removeRow(key: number) {
    setRows(rows.filter((row) => row.key !== key));
  }

  // 엔터는 제출이 아니라 다음 사람 칸으로 — 반쯤 쓴 명단이 실수로 등록되지 않게 한다 (한글 조합 중 엔터는 무시)
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const next = rows[index + 1];
    if (next) inputs.current[next.key]?.focus();
    else if (rows[index].name.trim()) addRow();
  }

  // 카톡·엑셀 명단(한 줄에 한 명)을 붙여 넣으면 사람마다 한 줄로 나눈다
  function onPaste(event: React.ClipboardEvent<HTMLInputElement>, index: number) {
    const people = parseInviteLines(event.clipboardData.getData('text'));
    if (people.length < 2) return;
    event.preventDefault();
    const merged = [...rows.slice(0, index), ...people.map(make), ...rows.slice(index + 1).filter((row) => row.name.trim() || row.phone.trim())];
    const overflow = merged.slice(GIG_INVITE_BATCH_MAX);
    setRows(merged.slice(0, GIG_INVITE_BATCH_MAX));
    setNote(overflow.length ? `한 번에 ${GIG_INVITE_BATCH_MAX}명까지 넣을 수 있어요. 넣지 못한 ${overflow.length}명(${overflow.map((row) => row.name || row.phone).join(', ')})은 이번 등록이 끝난 뒤 다시 넣어 주세요.` : '');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const people = rows.map((row) => ({ name: row.name.trim(), phone: row.phone.trim() })).filter((person) => person.name || person.phone);
    if (people.length === 0) { setError('초대할 사람의 이름을 입력해 주세요.'); return; }
    if (people.some((person) => !person.name)) { setError('전화번호만 있고 이름이 없는 줄이 있어요. 이름을 입력해 주세요.'); return; }
    busy.current = true; setPending(true); setError(''); setNote(''); setOutcome(null);
    const form = new FormData();
    form.set('project_id', projectId);
    form.set('people', JSON.stringify(people));
    try {
      const result = await runGigProjectAction('invite_participants', form);
      if (!result.ok) { setError(result.error ?? '등록하지 못했어요. 다시 시도해 주세요.'); return; }
      const batch = result.data as GigInviteBatch;
      setOutcome(batch);
      // 등록하지 못한 사람은 입력칸에 그대로 남겨 다시 보낼 수 있게 한다
      const left = batch.results.flatMap((row, index) => (row.ok ? [] : [make(people[index] ?? { name: row.name, phone: '' })]));
      setRows(left.length ? left : [make({ name: '', phone: '' })]);
      router.refresh();
    } catch {
      setError('등록하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      busy.current = false; setPending(false);
    }
  }

  const added = outcome?.results.filter((row) => row.ok) ?? [];
  const capped = outcome?.results.filter((row) => !row.ok && row.overCapacity) ?? [];
  const failed = outcome?.results.filter((row) => !row.ok && !row.overCapacity) ?? [];
  const total = outcome?.results.length ?? 0;
  const link = (token?: string) => `${workerOrigin}/gig/join?token=${token ?? ''}`;

  return <form onSubmit={submit} aria-busy={pending} className="mt-3 rounded-xl border border-line p-3">
    <p className="text-[0.75rem] font-extrabold text-ink">새 사람 초대</p>
    <p className="mt-1 text-[0.6875rem] leading-4 text-sub">이 근무 일정·시급으로 등록되고 사람마다 일회용 초대가 만들어져요. 전화번호는 선택 정보이며 자동 연결에 사용하지 않아요.</p>
    <fieldset disabled={pending} className="min-w-0 disabled:opacity-60">
      <ul className="mt-2 space-y-2">
        {rows.map((row, index) => <li key={row.key} className={`grid gap-2 ${many ? 'grid-cols-[minmax(0,5fr)_minmax(0,7fr)_2.5rem]' : 'grid-cols-2'}`}>
          <input value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} onKeyDown={(event) => onKeyDown(event, index)} onPaste={(event) => onPaste(event, index)}
            ref={(element) => { inputs.current[row.key] = element; if (element && focusKey.current === row.key) { focusKey.current = null; element.focus(); } }}
            maxLength={80} enterKeyHint="next" autoComplete="off" aria-label={many ? `${index + 1}번째 사람 이름` : '이름'} placeholder={many ? `이름 ${index + 1}` : '이름'}
            className="h-11 min-w-0 rounded-xl border border-line bg-white px-3 text-[0.8125rem]" />
          <input value={row.phone} onChange={(event) => update(row.key, { phone: event.target.value })} onKeyDown={(event) => onKeyDown(event, index)}
            inputMode="tel" enterKeyHint="next" autoComplete="off" aria-label={many ? `${index + 1}번째 사람 휴대전화 (선택)` : '휴대전화 (선택)'} placeholder="휴대전화 · 선택"
            className={`h-11 min-w-0 rounded-xl border border-line bg-white text-[0.8125rem] ${many ? 'px-2.5' : 'px-3'}`} />
          {many && <button type="button" onClick={() => removeRow(row.key)} aria-label={`${row.name.trim() || `${index + 1}번째 사람`} 줄 빼기`}
            className="flex h-11 w-10 items-center justify-center rounded-xl bg-bg text-[1rem] font-bold text-sub">×</button>}
        </li>)}
      </ul>
      <button type="button" onClick={addRow} disabled={rows.length >= GIG_INVITE_BATCH_MAX}
        className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-dashed border-primary/40 bg-white text-[0.75rem] font-extrabold text-primary disabled:border-line disabled:text-sub">
        {rows.length >= GIG_INVITE_BATCH_MAX ? `한 번에 ${GIG_INVITE_BATCH_MAX}명까지 넣을 수 있어요` : '+ 한 명 더'}
      </button>
      {!many && <p className="mt-1 text-[0.6875rem] leading-4 text-sub">여러 명이면 &apos;+ 한 명 더&apos;를 누르거나, 카톡·엑셀 명단(한 줄에 한 명)을 이름 칸에 붙여 넣으세요.</p>}
      <button className="mt-2 h-10 w-full rounded-xl bg-primary text-[0.75rem] font-extrabold text-white">
        {pending ? '등록 중...' : filled >= 2 ? `${filled}명 등록하고 초대 만들기` : '등록하고 일회용 초대 만들기'}
      </button>
    </fieldset>
    {pending && <p role="status" className="mt-2 text-[0.75rem] font-bold text-primary">{filled >= 2 ? `${filled}명을 차례로 등록하고 있어요. 잠시만 기다려 주세요.` : '처리 중...'}</p>}
    {note && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[0.75rem] font-bold leading-5 text-amber-800">{note}</p>}
    {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[0.75rem] font-bold text-red-600">{error}</p>}

    {outcome && <div aria-live="polite" className="mt-3 space-y-2">
      {added.length > 0 && <div className="rounded-xl border border-success/30 bg-success/5 p-3">
        <p role="status" className="text-[0.75rem] font-extrabold text-ink">
          {added.length < total ? `${total}명 중 ${added.length}명 등록했어요` : added.length === 1 ? '등록했어요' : `${added.length}명 등록했어요`}
          {added.length === 1 ? ' · 근무자가 직접 수락할 초대를 보내 주세요' : ' · 초대는 사람마다 따로예요. 한 명씩 보내 주세요'}
        </p>
        {added.length === 1
          ? <div className="mt-2">{added.length < total && <p className="mb-1 text-[0.8125rem] font-bold text-ink">{added[0].name}</p>}<CopyInviteButton url={link(added[0].inviteToken)} primary /></div>
          : <ul aria-label="방금 등록한 사람" className="mt-2 divide-y divide-success/20">{added.map((row, index) => <li key={`${row.name}-${index}`} className="flex flex-wrap items-center justify-between gap-x-3 py-1">
            <b className="min-w-0 text-[0.8125rem] text-ink">{row.name}</b>
            <CopyInviteButton url={link(row.inviteToken)} />
          </li>)}</ul>}
      </div>}
      {capped.length > 0 && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-[0.75rem] leading-5 text-amber-800">
        <p className="font-extrabold">{capped.length}명은 인원 한도 때문에 등록하지 못했어요</p>
        <p className="mt-1">지금 이용 중인 요금으로는 한 현장에 {outcome.limit}명까지 등록할 수 있어요. 수락을 기다리는 초대와 아직 시작 전인 근무자도 함께 세요.</p>
        <p className="mt-1 font-bold">못 넣은 사람: {capped.map((row) => row.name).join(', ')} · 입력칸에 그대로 남겨 뒀어요.</p>
        <Link href="/membership" className="mt-1 inline-flex min-h-10 items-center font-extrabold text-primary">이용 현황 보기 →</Link>
      </div>}
      {failed.length > 0 && <div role="alert" className="rounded-xl bg-red-50 p-3 text-[0.75rem] leading-5 text-red-600">
        <p className="font-extrabold">{failed.length}명은 등록하지 못했어요</p>
        <ul className="mt-1">{failed.map((row, index) => <li key={`${row.name}-${index}`}><b>{row.name}</b> · {row.error}</li>)}</ul>
        <p className="mt-1 font-bold">입력칸에 남겨 뒀어요. 고친 뒤 다시 눌러 주세요.</p>
      </div>}
    </div>}
  </form>;
}
