export type Credential = {
  worker_id: string;
  credential_type: string;
  expires_at: string | null;
  verification_status: string;
};

// A renewed, approved document supersedes expired history of the same type.
// Other document types remain independent: an optional expired certificate is
// a warning, not proof that the worker's professional licence has expired.
export function summarizeCredentials(rows: Credential[], role: string, today: string) {
  const byType = new Map<string, Credential>();
  const valid = (row: Credential) => row.verification_status === 'approved' && (!row.expires_at || row.expires_at >= today);
  for (const row of rows) {
    const previous = byType.get(row.credential_type);
    if (!previous || (valid(row) && !valid(previous)) || (valid(row) === valid(previous) && (row.expires_at ?? '9999-12-31') > (previous.expires_at ?? '9999-12-31'))) {
      byType.set(row.credential_type, row);
    }
  }
  const primaryType: Record<string, string> = { rn: 'nursing_license', na: 'na_certificate', pharmacist: 'pharmacist_license' };
  const primary = byType.get(primaryType[role]);
  const expired = (row: Credential) => row.verification_status === 'expired' || Boolean(row.expires_at && row.expires_at < today);
  const selected = [...byType.values()].sort((a, b) => (a.expires_at ?? '9999-12-31').localeCompare(b.expires_at ?? '9999-12-31'))[0];
  const days = selected?.expires_at ? Math.ceil((Date.parse(`${selected.expires_at}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
  const status: 'valid' | 'expiring' | 'expired' | 'missing' = !selected ? 'missing' : expired(selected) ? 'expired' : days !== null && days <= 30 ? 'expiring' : 'valid';
  return { selected, status, blocked: Boolean(primary && expired(primary)) };
}
