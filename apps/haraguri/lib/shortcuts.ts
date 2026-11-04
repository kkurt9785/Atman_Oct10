import type { Device } from './device';

export const NOTIFICATION_SHORTCUT_NAME = '하라구리 알림 수집';
export const NOTIFICATION_SHORTCUT_FILE = '/haraguri-notifications.shortcut';
export const PAIRING_SHORTCUT_NAME = '하라구리 계정 연결';
export const PAIRING_SHORTCUT_FILE = '/haraguri-connect.shortcut';
export type ShortcutRelease = {
  icloud_url?: string;
  name_normalization?: 'NFC' | 'NFD';
  ready: true; collector_ready: boolean; manual_trigger: boolean; requires_ios: 27;
  name: typeof NOTIFICATION_SHORTCUT_NAME | typeof PAIRING_SHORTCUT_NAME;
  file: typeof NOTIFICATION_SHORTCUT_FILE | typeof PAIRING_SHORTCUT_FILE;
};

export function parseShortcutRelease(value: unknown): ShortcutRelease | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (r.name_normalization !== undefined && r.name_normalization !== 'NFC' && r.name_normalization !== 'NFD') return null;
  if (r.ready !== true || r.requires_ios !== 27 || typeof r.collector_ready !== 'boolean') return null;
  if (r.manual_trigger !== undefined && typeof r.manual_trigger !== 'boolean') return null;
  const manual_trigger = r.manual_trigger === true;
  if (manual_trigger && r.collector_ready) return null;
  const collector = r.collector_ready || manual_trigger;
  const name = collector ? NOTIFICATION_SHORTCUT_NAME : PAIRING_SHORTCUT_NAME;
  const file = collector ? NOTIFICATION_SHORTCUT_FILE : PAIRING_SHORTCUT_FILE;
  if (r.icloud_url !== undefined && (typeof r.icloud_url !== 'string' || !/^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/.test(r.icloud_url))) return null;
  return r.name === name && r.file === file ? { ready: true, collector_ready: r.collector_ready, manual_trigger, requires_ios: 27, name, file, ...(r.icloud_url ? { icloud_url: r.icloud_url as string } : {}), name_normalization: r.name_normalization === 'NFD' ? 'NFD' : 'NFC' } : null;
}

export function shortcutPairingURL(code: string, name: ShortcutRelease['name'] = NOTIFICATION_SHORTCUT_NAME, normalization: 'NFC' | 'NFD' = 'NFC', origin = 'https://haraguri.vercel.app', retry = false) {
  if (!/^[0-9a-f]{48}$/.test(code)) throw new Error('잘못된 연결 코드예요. 다시 시도해 주세요.');
  const callback = new URL('/pair', origin);
  callback.searchParams.set('code', code);
  callback.searchParams.set('shortcutNormalization', normalization);
  callback.searchParams.set('pairRetry', retry ? 'failed' : normalization === 'NFC' ? 'nfd' : 'nfc');
  const success = new URL('/pair', origin);
  success.searchParams.set('code', code);
  success.searchParams.set('shortcutNormalization', normalization);
  success.searchParams.set('pairResult', 'success');
  // Shortcuts treats '+' literally in names. Keep spaces as %20.
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(name.normalize(normalization))}&input=text&text=${code}&x-error=${encodeURIComponent(callback.href)}&x-success=${encodeURIComponent(success.href)}`;
}

// Galaxy companion app (apps/haraguri-android): same pairing code, delivered as an Android intent link.
// Chrome and Samsung Internet open the app when it is installed and fall back to the install page when it is not.
export const ANDROID_PACKAGE = 'app.haraguri.collect';
export const ANDROID_APK_PATH = '/haraguri-collect.apk';
export function androidPairingURL(code: string, origin = 'https://haraguri.vercel.app') {
  if (!/^[0-9a-f]{48}$/.test(code)) throw new Error('잘못된 연결 코드예요. 다시 시도해 주세요.');
  const fallback = new URL('/?tab=money&collect=1&android=install', origin);
  return `intent://pair?code=${code}#Intent;scheme=haraguri;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback.href)};end`;
}

export function canRetryPairing(status: string, attempted: boolean, phase: string | null) {
  return (phase === 'nfd' || phase === 'nfc') && status === 'pending' && !attempted;
}

export function shortcutOpenURL(name: string = NOTIFICATION_SHORTCUT_NAME, normalization: 'NFC' | 'NFD' = 'NFC') {
  return `shortcuts://open-shortcut?name=${encodeURIComponent(name.normalize(normalization))}`;
}

export type IngestDelivery = {
  via: string; app: string; raw: string; status: 'saved' | 'duplicate' | 'ignored' | 'unparsed';
};

export function isCollectorDelivery(row: IngestDelivery, device: Device) {
  if (!row.raw.trim() || row.via === 'test' || /하라구리 연결 테스트/.test(row.raw)) return false;
  if (device === 'galaxy') return row.via === 'android';
  if (device === 'iphone-sms') return ['ios-sms', ''].includes(row.via) || (row.via === 'ios-shortcut' && /Web발신/i.test(row.raw));
  if (/Web발신/i.test(row.raw)) return false;
  return row.via === 'ios-notification' || (row.via === 'ios-shortcut' && !!row.app && !/MobileSMS|메시지|Messages/i.test(row.app));
}

export function isCollectedPayment(row: IngestDelivery, device: Device) {
  return isCollectorDelivery(row, device) && (row.status === 'saved' || row.status === 'duplicate');
}
