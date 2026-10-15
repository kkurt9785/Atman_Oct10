import { supabase } from '@/lib/supabase';

// The database commits the account changes and file-cleanup jobs together.
// A refused/failed request must never remove a file in the browser first.
export async function withdrawWorkerAccount() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('로그인 상태를 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요.');
  const { data, error } = await supabase.rpc('withdraw_my_account');
  if (error) throw new Error(error.message.replace(/^.*?: /, '') || '탈퇴하지 못했어요. 다시 시도해 주세요.');
  if (data !== true) throw new Error('탈퇴 결과를 확인하지 못했어요. 다시 시도하거나 고객센터로 문의해 주세요.');
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
