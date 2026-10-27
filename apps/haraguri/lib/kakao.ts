import { supabase } from './supabase';

export async function startKakaoLogin(linkExisting = false) {
  if (!supabase) throw new Error('로그인 연결 설정을 확인해 주세요.');
  if (/KAKAOTALK/i.test(navigator.userAgent)) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.origin)}`;
    return;
  }
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''},cache:'no-store'});
  if(!response.ok)throw new Error('로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  const settings=await response.json();
  if(!settings.external?.kakao)throw new Error('카카오 로그인 연결 설정이 아직 완료되지 않았어요. 설정 완료 후 이용할 수 있습니다.');
  const options = {redirectTo: `${window.location.origin}/auth/callback`, scopes: 'profile_nickname profile_image'};
  const result = linkExisting
    ? await supabase.auth.linkIdentity({provider:'kakao',options})
    : await supabase.auth.signInWithOAuth({provider:'kakao',options});
  if(result.error) throw new Error('카카오 로그인에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
}
