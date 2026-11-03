import { describe, expect, it } from 'vitest';
import { detectDevice, iosMajor } from './device';

describe('phone detection for the collect wizard', () => {
  it('sends every iPhone to the notification-trigger recipe — the UA version cannot be trusted (an iOS 27.2 device reported < 27)', () => {
    const ios27 = detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148');
    expect(ios27).toMatchObject({ device: 'iphone-push', ios: '27.0' });
    const ios18 = detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
    expect(ios18).toMatchObject({ device: 'iphone-push', ios: '18.7' });
    expect(iosMajor(ios18.ios)).toBe(18);
  });
  it('recognises Android and falls back to the iPhone push recipe on desktop', () => {
    expect(detectDevice('Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36')).toMatchObject({ device: 'galaxy', android: true });
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toMatchObject({ device: 'iphone-push', ios: null });
  });
});
