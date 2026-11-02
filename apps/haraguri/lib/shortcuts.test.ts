import { describe, expect, it } from 'vitest';
import { isCollectedPayment, isCollectorDelivery, NOTIFICATION_SHORTCUT_NAME, PAIRING_SHORTCUT_NAME, parseShortcutRelease, shortcutPairingURL, type IngestDelivery } from './shortcuts';

const delivery = (patch: Partial<IngestDelivery> = {}): IngestDelivery => ({ via: 'ios-notification', app: '', raw: '스타벅스 10,000원 결제', status: 'saved', ...patch });

describe('shortcut pairing link', () => {
  it('passes a one-time code to the named shortcut without a collection address', () => {
    const code = 'ab'.repeat(24);
    const url = new URL(shortcutPairingURL(code));
    expect(url.protocol).toBe('shortcuts:');
    expect(url.hostname).toBe('run-shortcut');
    expect(url.searchParams.get('name')).toBe(NOTIFICATION_SHORTCUT_NAME);
    expect(url.searchParams.get('input')).toBe('text');
    expect(url.searchParams.get('text')).toBe(code);
    expect(url.href).not.toContain('supabase');
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
