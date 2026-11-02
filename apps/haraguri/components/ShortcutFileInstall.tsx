import type { ShortcutRelease } from '../lib/shortcuts';

export function ShortcutFileInstall({ release, onInstall }: { release: ShortcutRelease; onInstall?: () => void }) {
  if (release.icloud_url) return <a className="button-link primary" href={release.icloud_url} target="_blank" rel="noopener noreferrer" onClick={onInstall}>단축어 추가</a>;
  return <details><summary>파일로 설치하기</summary><a className="button-link" href={release.file} download={`${release.name.normalize('NFC')}.shortcut`} onClick={onInstall}>단축어 받기</a></details>;
}
