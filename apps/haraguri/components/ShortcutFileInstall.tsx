'use client';
import { useEffect, useState } from 'react';
import type { ShortcutRelease } from '../lib/shortcuts';

// Prepare the public signed file before the tap. Safari requires share() to
// happen during that tap; awaiting a download first can lose the permission.
export function ShortcutFileInstall({ release, onInstall }: { release: ShortcutRelease; onInstall?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setFile(null); setError('');
    if (!navigator.share || !navigator.canShare) return;
    fetch(release.file, { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 1_048_576 || new TextDecoder().decode(buffer.slice(0, 4)) !== 'AEA1') return;
      const prepared = new File([buffer], `${release.name}.shortcut`, { type: 'application/octet-stream' });
      if (active && navigator.canShare({ files: [prepared] })) setFile(prepared);
    }).catch(() => {});
    return () => { active = false; };
  }, [release.file, release.name]);

  async function install() {
    if (!file || sharing) return;
    setSharing(true); setError('');
    try {
      // Invoke first, before any asynchronous account preparation.
      const transfer = navigator.share({ files: [file] });
      onInstall?.();
      await transfer;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError('파일을 열지 못했어요. 아래 파일 받기로 추가해 주세요.');
    } finally { setSharing(false); }
  }

  const download = <a className="button-link" href={release.file} target="_blank" rel="noopener" download={`${release.name}.shortcut`} onClick={onInstall}>단축어 받기</a>;
  return <div>
    {file ? <>
      <button type="button" className="primary" disabled={sharing} onClick={() => { void install(); }}>{sharing ? '여는 중…' : '단축어 추가'}</button>
      <p className="muted">공유 화면에서 단축어로 열거나, <b>파일에 저장 → 나의 iPhone</b>에 저장한 뒤 파일을 열어 추가해 주세요. iCloud에 저장할 필요가 없어요.</p>
      <details className="recipe"><summary>파일로 받아 추가하기</summary>{download}<p className="muted">저장 위치는 iCloud Drive 대신 <b>나의 iPhone</b>을 고를 수 있어요.</p></details>
    </> : download}
    {error && <p className="recipe-warn" role="alert">{error}</p>}
  </div>;
}
