import { afterEach, describe, expect, it, vi } from 'vitest';
const auth=vi.hoisted(()=>({signInWithOAuth:vi.fn(),linkIdentity:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth}}));
import {startKakaoLogin} from './kakao';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function setup(enabled=true) {
 vi.stubGlobal('navigator',{userAgent:'Mobile Safari'});
 vi.stubGlobal('window',{location:{origin:'https://haraguri.vercel.app',href:''}});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({external:{kakao:enabled}})}));
 auth.signInWithOAuth.mockResolvedValue({error:null});auth.linkIdentity.mockResolvedValue({error:null});
}
describe('Kakao login integration',()=>{
 it('uses a fixed same-origin callback and does not request email',async()=>{
  setup();await startKakaoLogin();
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({provider:'kakao',options:{redirectTo:'https://haraguri.vercel.app/auth/callback',scopes:'profile_nickname profile_image'}});
 });
 it('links an existing account without starting a new sign-in',async()=>{
  setup();await startKakaoLogin(true);expect(auth.linkIdentity).toHaveBeenCalled();expect(auth.signInWithOAuth).not.toHaveBeenCalled();
 });
 it('keeps disabled-provider failures inside the app',async()=>{
  setup(false);await expect(startKakaoLogin()).rejects.toThrow('아직 완료되지');expect(auth.signInWithOAuth).not.toHaveBeenCalled();
 });
 it('opens an external browser from KakaoTalk without starting OAuth there',async()=>{
  setup();vi.stubGlobal('navigator',{userAgent:'KAKAOTALK'});await startKakaoLogin();expect(window.location.href).toContain('kakaotalk://web/openExternal');expect(auth.signInWithOAuth).not.toHaveBeenCalled();
 });
});
