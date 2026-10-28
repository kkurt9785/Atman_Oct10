// Which phone-setup recipe to show first. iOS 27 is the first version whose Shortcuts app can react to another app's notification.
export type Device = 'iphone-push' | 'iphone-sms' | 'galaxy';
export const IOS_NOTIFICATION_TRIGGER_MIN = 27;

export function detectDevice(ua: string): { device: Device; ios: string | null; android: boolean } {
  const iphone = /iPhone|iPad|iPod/.test(ua);
  const m = ua.match(/OS (\d+)[_.](\d+)/);
  if (iphone) {
    const major = m ? Number(m[1]) : 0;
    return { device: major >= IOS_NOTIFICATION_TRIGGER_MIN ? 'iphone-push' : 'iphone-sms', ios: m ? `${m[1]}.${m[2]}` : null, android: false };
  }
  if (/Android/.test(ua)) return { device: 'galaxy', ios: null, android: true };
  return { device: 'iphone-push', ios: null, android: false }; // desktop: show the recipe we most want people to set up
}

export function iosMajor(ios: string | null) { return ios ? Number(ios.split('.')[0]) : null; }
