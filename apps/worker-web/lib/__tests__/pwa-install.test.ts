import {describe,it,expect,vi} from 'vitest';
import {createInstallController,installPlatform,type InstallPrompt} from '../pwa-install';
function event(outcome:'accepted'|'dismissed'='accepted') {return {preventDefault:vi.fn(),prompt:vi.fn().mockResolvedValue(undefined),userChoice:Promise.resolve({outcome})} as unknown as InstallPrompt;}
describe('PWA installation truth and browser guidance',()=>{
  it('recognizes iPadOS desktop UA without classifying ordinary Macs as iOS',()=>{
    expect(installPlatform('Mozilla Macintosh Safari',5).ios).toBe(true);
    expect(installPlatform('Mozilla Macintosh Safari',0).ios).toBe(false);
    expect(installPlatform('iPhone Safari',1).ios).toBe(true);
  });
  it('recognizes in-app iOS separately from Safari installation',()=>{
    expect(installPlatform('iPhone KAKAOTALK',1)).toEqual({ios:true,inApp:true});
    expect(installPlatform('Android; wv) Chrome',1).inApp).toBe(true);
  });
  it('accepted is pending, not installed; only appinstalled confirms completion',async()=>{
    const controller=createInstallController();controller.offer(event());await controller.install();
    expect(controller.snapshot()).toMatchObject({pending:true,installed:false,busy:false,available:false});
    controller.installed();expect(controller.snapshot()).toMatchObject({pending:false,installed:true});
  });
  it('two UI consumers cannot prompt the same one-shot event twice',async()=>{
    const controller=createInstallController(),prompt=event();controller.offer(prompt);
    await Promise.all([controller.install(),controller.install()]);await controller.install();
    expect(prompt.prompt).toHaveBeenCalledTimes(1);
  });
  it('dismissal consumes the prompt and permits a fresh browser event',async()=>{
    const controller=createInstallController();controller.offer(event('dismissed'));await controller.install();
    expect(controller.snapshot()).toMatchObject({pending:false,installed:false,available:false});
    controller.offer(event());expect(controller.snapshot().available).toBe(true);
  });
  it('prompt rejection restores controls with honest fallback guidance',async()=>{
    const controller=createInstallController(),prompt=event();vi.mocked(prompt.prompt).mockRejectedValue(Error('unsupported'));controller.offer(prompt);await controller.install();
    expect(controller.snapshot()).toMatchObject({busy:false,installed:false,available:false});
    expect(controller.snapshot().error).toContain('브라우저 메뉴');
  });
  it('installed event during prompt processing is not reverted to pending',async()=>{
    const controller=createInstallController(),prompt=event();vi.mocked(prompt.prompt).mockImplementation(async()=>controller.installed());controller.offer(prompt);await controller.install();
    expect(controller.snapshot()).toMatchObject({installed:true,pending:false,busy:false});
  });
});
