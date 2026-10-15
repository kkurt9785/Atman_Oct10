import { adminClient } from './supabase';

type Job = { id: string; bucket_id: string; object_path: string };

export async function cleanupAccountStorage() {
  const sb = adminClient();
  if (!sb) throw new Error('Storage cleanup is not configured');
  const { data, error } = await sb.rpc('claim_account_storage_cleanup', { p_limit: 20 });
  if (error) throw new Error('Storage cleanup jobs could not be loaded');
  let completed = 0, retrying = 0;
  for (const job of (data ?? []) as Job[]) {
    let success = false;
    try {
      if (job.bucket_id === 'license-photos' && /^[0-9a-f-]{36}\//i.test(job.object_path)) {
        const { error: removeError } = await sb.storage.from(job.bucket_id).remove([job.object_path]);
        success = !removeError;
      }
    } catch { /* Keep the job for a retry; never log file paths or credentials. */ }
    const { error: finishError } = await sb.rpc('finish_account_storage_cleanup', { p_id: job.id, p_success: success });
    if (finishError) throw new Error('Storage cleanup result could not be saved');
    if (success) completed += 1;
    else retrying += 1;
  }
  return { completed, retrying };
}
