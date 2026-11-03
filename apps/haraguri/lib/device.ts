// Which phone-setup recipe to show first. iOS 27 is the first version whose Shortcuts app can react to another app's notification.
export type Device = 'iphone-push' | 'iphone-sms' | 'galaxy';
export const IOS_NOTIFICATION_TRIGGER_MIN = 27;

export function detectDevice(ua: string): { device: Device; ios: string | null; android: boolean } {
  const iphone = /iPhone|iPad|iPod/.test(ua);
  const m = ua.match(/OS (\d+)[_.](\d+)/);
  // Safari's UA no longer tracks the real iOS version (an iOS 27.2 iPhone reported itself below 27 on 2026-11-03), so every iPhone
  // gets the notification recipe; the SMS recipe stays one chip away under 고급. `ios` is kept for display only.
  if (iphone) return { device: 'iphone-push', ios: m ? `${m[1]}.${m[2]}` : null, android: false };
  if (/Android/.test(ua)) return { device: 'galaxy', ios: null, android: true };
  return { device: 'iphone-push', ios: null, android: false }; // desktop: show the recipe we most want people to set up
}

export function iosMajor(ios: string | null) { return ios ? Number(ios.split('.')[0]) : null; }
