// Notification payloads are data, never executable or off-site navigation.
export function safeNotificationPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value, 'https://notification.invalid');
    return parsed.origin === 'https://notification.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch { return null; }
}
