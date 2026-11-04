import { describe, expect, it } from 'vitest';
import { ANDROID_PACKAGE, androidPairingURL, isCollectedPayment, isCollectorDelivery, NOTIFICATION_SHORTCUT_NAME, PAIRING_SHORTCUT_NAME, parseShortcutRelease, shortcutPairingURL, canRetryPairing, type IngestDelivery } from './shortcuts';

const delivery = (patch: Partial<IngestDelivery> = {}): IngestDelivery => ({ via: 'ios-notification', app: '', raw: '스타벅스 10,000원 결제', status: 'saved', ...patch });

describe('galaxy app pairing link', () => {
  it('opens the companion app with the code and falls back to the install page', () => {
    const code = 'cd'.repeat(24);
    const url = androidPairingURL(code, 'https://haraguri.vercel.app');
    expect(url.startsWith(`intent://pair?code=${code}#Intent;`)).toBe(true);
    expect(url).toContain('scheme=haraguri;');
    expect(url).toContain(`package=${ANDROID_PACKAGE};`);
    expect(decodeURIComponent(url.split('S.browser_fallback_url=')[1].split(';end')[0])).toBe('https://haraguri.vercel.app/?tab=money&collect=1&android=install');
    expect(url).not.toContain('supabase');
    expect(() => androidPairingURL('nope')).toThrow();
  });
});

describe('shortcut pairing link', () => {
  it('passes a one-time code to the named shortcut without a collection address', () => {
    const code = 'ab'.repeat(24);
    const url = new URL(shortcutPairingURL(code));
    expect(url.protocol).toBe('shortcuts:');
    expect(url.hostname).toBe('x-callback-url');
    expect(url.pathname).toBe('/run-shortcut');
    expect(url.searchParams.get('name')).toBe(NOTIFICATION_SHORTCUT_NAME);
    expect(url.searchParams.get('input')).toBe('text');
    expect(url.searchParams.get('text')).toBe(code);
    expect(url.href).not.toContain('supabase');
  });
  it('encodes spaces as %20 and sends failures back for a single NFD retry', () => {
    const url = shortcutPairingURL('ab'.repeat(24));
    expect(url).toContain('%20');
    expect(url).not.toContain('+');
    const callback = new URL(new URL(url).searchParams.get('x-error')!);
    expect(callback.pathname).toBe('/pair');
    expect(callback.searchParams.get('pairRetry')).toBe('nfd');
    expect(callback.searchParams.get('code')).toBe('ab'.repeat(24));
  });
  it('uses the same code with an NFD name and a terminal error callback', () => {
    const url = new URL(shortcutPairingURL('ab'.repeat(24), NOTIFICATION_SHORTCUT_NAME, 'NFD', 'https://haraguri.vercel.app', true));
    expect(url.searchParams.get('name')).toBe(NOTIFICATION_SHORTCUT_NAME.normalize('NFD'));
    expect(url.searchParams.get('text')).toBe('ab'.repeat(24));
    expect(new URL(url.searchParams.get('x-error')!).searchParams.get('pairRetry')).toBe('failed');
  });
  it('retries only a failed, unclaimed code once', () => {
    expect(canRetryPairing('pending', false, 'nfd')).toBe(true);
    expect(canRetryPairing('pending', true, 'nfd')).toBe(false);
    for (const status of ['claimed', 'expired', 'missing']) expect(canRetryPairing(status, false, 'nfd')).toBe(false);
    expect(canRetryPairing('pending', false, 'failed')).toBe(false);
    expect(canRetryPairing('pending', false, null)).toBe(false);
  });
  it('validates the iCloud release link', () => {
    const release = { ready: true, collector_ready: true, requires_ios: 27, name: NOTIFICATION_SHORTCUT_NAME, file: '/haraguri-notifications.shortcut', icloud_url: 'https://www.icloud.com/shortcuts/273c25287f24405b913d5237fd9f5168' };
    expect(parseShortcutRelease(release)?.icloud_url).toBe(release.icloud_url);
    expect(parseShortcutRelease({ ...release, icloud_url: 'javascript:alert(1)' })).toBeNull();
    expect(parseShortcutRelease({ ...release, icloud_url: 'https://evil.example/shortcuts/273c25287f24405b913d5237fd9f5168' })).toBeNull();
  });
  it('calls the published NFD shortcut by its exact imported name on the first attempt', () => {
    const release = parseShortcutRelease({ ready: true, collector_ready: true, requires_ios: 27, name: NOTIFICATION_SHORTCUT_NAME, file: '/haraguri-notifications.shortcut', name_normalization: 'NFD' })!;
    const url = new URL(shortcutPairingURL('ab'.repeat(24), release.name, release.name_normalization));
    expect(url.searchParams.get('name')).toBe(NOTIFICATION_SHORTCUT_NAME.normalize('NFD'));
    expect(new URL(url.searchParams.get('x-error')!).searchParams.get('pairRetry')).toBe('nfc');
    expect(new URL(url.searchParams.get('x-success')!).searchParams.get('shortcutNormalization')).toBe('NFD');
    expect(canRetryPairing('pending', false, 'nfc')).toBe(true);
    expect(canRetryPairing('claimed', false, 'nfc')).toBe(false);
  });
  it.each(['', 'not-a-code', 'ab'.repeat(23), 'ab'.repeat(25), 'https://example.com/'])('rejects invalid code %s', code => {
    expect(() => shortcutPairingURL(code)).toThrow();
  });
  it('runs the pairing-only prototype by its own installed name', () => {
    expect(new URL(shortcutPairingURL('ab'.repeat(24), PAIRING_SHORTCUT_NAME)).searchParams.get('name')).toBe(PAIRING_SHORTCUT_NAME);
  });
  it('keeps a pairing prototype separate from a complete collector release', () => {
    expect(parseShortcutRelease({ ready: true, collector_ready: false, requires_ios: 27, name: PAIRING_SHORTCUT_NAME, file: '/haraguri-connect.shortcut' })?.collector_ready).toBe(false);
    expect(parseShortcutRelease({ ready: true, collector_ready: true, requires_ios: 27, name: NOTIFICATION_SHORTCUT_NAME, file: '/haraguri-notifications.shortcut' })?.collector_ready).toBe(true);
    expect(parseShortcutRelease({ ready: true, collector_ready: true, requires_ios: 27, name: PAIRING_SHORTCUT_NAME, file: '/haraguri-connect.shortcut' })).toBeNull();
    expect(parseShortcutRelease({ ready: true, collector_ready: false, requires_ios: 27, name: PAIRING_SHORTCUT_NAME, file: 'https://example.com/install' })).toBeNull();
    expect(parseShortcutRelease({ ready: false })).toBeNull();
  });
  it('explicitly identifies a collector that needs a notification automation added on the phone', () => {
    const release = { ready: true, collector_ready: false, manual_trigger: true, requires_ios: 27, name: NOTIFICATION_SHORTCUT_NAME, file: '/haraguri-notifications.shortcut' };
    expect(parseShortcutRelease(release)).toMatchObject({ manual_trigger: true, collector_ready: false });
    expect(parseShortcutRelease({ ...release, collector_ready: true })).toBeNull();
    expect(parseShortcutRelease({ ...release, manual_trigger: 'true' })).toBeNull();
    expect(parseShortcutRelease({ ...release, manual_trigger: false })).toBeNull();
  });
});

describe('collection evidence', () => {
  it('requires actual notification delivery to confirm an iPhone app payment', () => {
    expect(isCollectedPayment(delivery(), 'iphone-push')).toBe(true);
    expect(isCollectedPayment(delivery({ status: 'duplicate' }), 'iphone-push')).toBe(true);
    expect(isCollectedPayment(delivery({ via: 'ios-shortcut', raw: '[Web발신] 신한카드 승인 1,000원' }), 'iphone-push')).toBe(false);
    expect(isCollectedPayment(delivery({ via: 'ios-shortcut' }), 'iphone-push')).toBe(false);
  });
  it('distinguishes receipt from successful payment parsing', () => {
    expect(isCollectorDelivery(delivery({ status: 'unparsed' }), 'iphone-push')).toBe(true);
    expect(isCollectedPayment(delivery({ status: 'unparsed' }), 'iphone-push')).toBe(false);
    expect(isCollectorDelivery(delivery({ status: 'ignored', raw: '마일리지 적립 안내' }), 'iphone-push')).toBe(true);
  });
  it('never treats pairing, a test ping, or an empty request as real collection', () => {
    for (const row of [delivery({ raw: '' }), delivery({ via: 'ios-shortcut-pairing', status: 'ignored', raw: '' }), delivery({ via: 'test' }), delivery({ raw: '하라구리 연결 테스트' })]) {
      expect(isCollectorDelivery(row, 'iphone-push')).toBe(false);
      expect(isCollectedPayment(row, 'iphone-push')).toBe(false);
    }
  });
  it('does not treat a manually restored notification as proof that phone automation ran', () => {
    expect(isCollectorDelivery(delivery({ via: 'notification-replay' }), 'iphone-push')).toBe(false);
    expect(isCollectedPayment(delivery({ via: 'notification-replay' }), 'iphone-push')).toBe(false);
  });
  it('recognizes unambiguous legacy app input and keeps SMS separate', () => {
    expect(isCollectedPayment(delivery({ via: 'ios-shortcut', app: 'KB Pay' }), 'iphone-push')).toBe(true);
    expect(isCollectedPayment(delivery({ via: 'ios-shortcut', app: 'com.apple.MobileSMS' }), 'iphone-push')).toBe(false);
    expect(isCollectedPayment(delivery({ via: 'ios-shortcut', raw: '[Web발신] 신한카드 승인 1,000원' }), 'iphone-sms')).toBe(true);
    expect(isCollectedPayment(delivery({ via: 'android' }), 'galaxy')).toBe(true);
  });
});
