'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, CategoryRule, Expense, money, today } from '../lib/model';
import { categories } from '../lib/finance';
import { guessCategory, matchRule } from '../lib/cardsms.core';
import { OcrRow, parseOcrText } from '../lib/ocr';

// Screenshot → transactions, on the phone. The picture never leaves the device unless the person explicitly asks for AI recognition.
export type ImportRow = OcrRow & { id: string; selected: boolean; category: string; duplicate: boolean };
type OcrHook = (file: File) => Promise<string>;

async function toCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(2.5, Math.max(1, 1600 / bitmap.width)); // small phone captures upscale; OCR likes ~30px glyphs
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // Grayscale, and invert dark-mode captures so text is dark on light; no hard threshold (it breaks thin Korean strokes).
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height); const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; sum += g; }
  if (sum / (d.length / 4) < 110) for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 - d[i]; }
  ctx.putImageData(img, 0, 0);
  bitmap.close?.();
  return canvas;
}

async function recognizeOnDevice(file: File, onProgress: (p: number) => void): Promise<string> {
  const hook = (window as Window & { __haraguriOcr?: OcrHook }).__haraguriOcr; // test seam: QA injects text instead of running OCR
  if (hook) return hook(file);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('kor+eng', 1, { logger: m => { if (m.status === 'recognizing text') onProgress(m.progress); } });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const canvas = await toCanvas(file);
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally { await worker.terminate(); }
}

export function CaptureImport({ cards, expenses, rules, busy, onImport, onAi, initialFiles }: {
  cards: Card[]; expenses: Expense[]; rules: CategoryRule[]; busy: boolean; initialFiles?: File[]; // e.g. a screenshot that arrived through the Android share sheet
  onImport: (rows: ImportRow[], cardId: string | null) => Promise<void>;
  onAi?: (file: File) => Promise<OcrRow[]>; // optional server-side recognition; shown with explicit consent copy
}) {
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [cardId, setCardId] = useState(cards.length === 1 ? cards[0].id : '');
  const [engine, setEngine] = useState<'device' | 'ai' | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);

  const toRows = (found: OcrRow[]) => found.map((r, i) => {
    const duplicate = expenses.some(e => e.date === r.date && Number(e.amount) === r.amount);
    const rule = matchRule(r.merchant, rules);
    return { ...r, id: `o${Date.now()}-${i}`, selected: !duplicate, duplicate, category: rule?.category ?? guessCategory(r.merchant) };
  });
  async function run(list: File[], mode: 'device' | 'ai') {
    if (running.current || !list.length) return;
    running.current = true; setError(''); setRows([]); setEngine(mode);
    const all: OcrRow[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        setStatus(`${list.length > 1 ? `${i + 1}/${list.length}번째 ` : ''}${mode === 'ai' ? 'AI가 읽는 중…' : '폰에서 글자를 읽는 중… (처음엔 한글 데이터 10MB를 받아요)'}`); setProgress(0);
        if (mode === 'ai') { if (!onAi) throw new Error('AI 인식을 사용할 수 없어요.'); all.push(...await onAi(list[i])); }
        else all.push(...parseOcrText(await recognizeOnDevice(list[i], setProgress)));
      }
      const parsed = toRows(all);
      setRows(parsed);
      setStatus(parsed.length ? `${parsed.length}건 찾았어요. 틀린 건 고치고, 넣을 것만 체크하세요.` : '거래를 찾지 못했어요. 이용내역 목록이 크게 보이게 다시 캡처하거나 AI 정밀 인식을 눌러 보세요.');
    } catch (e) { setError(e instanceof Error ? e.message : '인식에 실패했어요.'); setStatus(''); }
    finally { running.current = false; }
  }
  useEffect(() => { if (files.length) void run(files, 'device'); }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = rows.filter(r => r.selected);
  const update = (id: string, patch: Partial<ImportRow>) => setRows(list => list.map(r => r.id === id ? { ...r, ...patch } : r));
  return <div className="capture-import">
    <p className="privacy-line">🔒 캡처한 사진은 <b>폰 안에서만</b> 읽어요. 서버로 보내지 않고, 카드사 아이디·비밀번호도 필요 없어요.</p>
    <p className="muted">카드앱·은행앱·네이버페이의 <b>이용내역 화면을 캡처</b>해서 고르세요. 여러 장도 한 번에 돼요.</p>
    <input ref={input} className="sr-only" type="file" accept="image/*" multiple aria-label="이용내역 캡처 선택" onChange={e => { const list = Array.from(e.target.files ?? []).slice(0, 8); e.target.value = ''; if (list.length) setFiles(list); }}/>
    <div className="capture-actions"><button type="button" className="primary" disabled={busy || running.current} onClick={() => input.current?.click()}>📷 캡처 고르기</button>{files.length > 0 && onAi && <button type="button" className="secondary" disabled={busy || running.current} onClick={() => { if (window.confirm('AI 정밀 인식은 캡처 이미지를 우리 서버를 거쳐 AI에 보내 읽어요. 저장하지 않고 바로 버립니다. 진행할까요?')) void run(files, 'ai'); }}>✨ AI 정밀 인식</button>}</div>
    {status && <p role="status" className="capture-status">{status}{engine === 'device' && progress > 0 && progress < 1 && <progress value={progress} max={1}/>}</p>}
    {error && <p role="alert" className="error banner">{error}</p>}
    {rows.length > 0 && <>
      <label>어느 카드·수단으로 쓴 내역인가요?<select value={cardId} onChange={e => setCardId(e.target.value)}><option value="">결제수단 미확인</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="import-table" role="table" aria-label="인식된 거래">
        {rows.map(r => <div className={`import-row ${r.selected ? '' : 'off'} ${r.duplicate ? 'dup' : ''}`} role="row" key={r.id}>
          <label className="import-check"><input type="checkbox" checked={r.selected} onChange={e => update(r.id, { selected: e.target.checked })} aria-label={`${r.merchant} 포함`}/></label>
          <input type="date" value={r.date} aria-label="날짜" onChange={e => update(r.id, { date: e.target.value })}/>
          <input value={r.merchant} aria-label="사용처" maxLength={200} onChange={e => update(r.id, { merchant: e.target.value })}/>
          <input type="number" value={r.amount} aria-label="금액" step="1" onChange={e => update(r.id, { amount: Number(e.target.value) })}/>
          <select value={r.category} aria-label="분류" onChange={e => update(r.id, { category: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select>
          {r.duplicate && <small className="dup-tag">이미 있음</small>}
        </div>)}
      </div>
      <p className="muted import-summary">새로 넣을 것 <b>{rows.filter(r => !r.duplicate).length}건</b> · 이미 있는 것 <b>{rows.filter(r => r.duplicate).length}건</b>(해제됨) — 빠진 거래만 골라 채우는 용도예요. 언제든 다시 캡처해 올려도 겹치지 않아요.</p>
      <button type="button" className="primary wide" disabled={busy || !selected.length} onClick={() => onImport(selected, cardId || null)}>{selected.length}건 가계부에 추가 · {money(selected.reduce((s, r) => s + r.amount, 0))}</button>
      <small className="muted">같은 날 같은 금액이 이미 있으면 '이미 있음'으로 표시하고 기본 해제했어요. 추가한 뒤에도 내역에서 수정할 수 있어요. 오늘 {today()} 기준으로 연도를 추정했어요.</small>
    </>}
  </div>;
}
