import type { Device } from './device';

export const NOTIFICATION_SHORTCUT_NAME = '하라구리 알림 수집';
export const NOTIFICATION_SHORTCUT_FILE = '/haraguri-notifications.shortcut';
export const PAIRING_SHORTCUT_NAME = '하라구리 계정 연결';
export const PAIRING_SHORTCUT_FILE = '/haraguri-connect.shortcut';
export type ShortcutRelease = {
  ready: true; collector_ready: boolean; manual_trigger: boolean; requires_ios: 27;
  name: typeof NOTIFICATION_SHORTCUT_NAME | typeof PAIRING_SHORTCUT_NAME;
  file: typeof NOTIFICATION_SHORTCUT_FILE | typeof PAIRING_SHORTCUT_FILE;
};

export function parseShortcutRelease(value: unknown): ShortcutRelease | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (r.ready !== true || r.requires_ios !== 27 || typeof r.collector_ready !== 'boolean') return null;
  if (r.manual_trigger !== undefined && typeof r.manual_trigger !== 'boolean') return null;
  const manual_trigger = r.manual_trigger === true;
  if (manual_trigger && r.collector_ready) return null;
  const collector = r.collector_ready || manual_trigger;
  const name = collector ? NOTIFICATION_SHORTCUT_NAME : PAIRING_SHORTCUT_NAME;
  const file = collector ? NOTIFICATION_SHORTCUT_FILE : PAIRING_SHORTCUT_FILE;
  return r.name === name && r.file === file ? { ready: true, collector_ready: r.collector_ready, manual_trigger, requires_ios: 27, name, file } : null;
}

export function shortcutPairingURL(code: string, name: ShortcutRelease['name'] = NOTIFICATION_SHORTCUT_NAME) {
  if (!/^[0-9a-f]{48}$/.test(code)) throw new Error('잘못된 연결 코드예요. 다시 시도해 주세요.');
  const params = new URLSearchParams({ name, input: 'text', text: code });
  return `shortcuts://run-shortcut?${params}`;
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
