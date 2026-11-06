# 관리자 시연 링크(admin.itdot.co.kr/demo) 카톡 미리보기 그림 1200×630 → apps/admin-web/public/og/demo.png
# 사용: python3 scripts/make_admin_demo_og.py   (글꼴: ~/Library/Fonts/Pretendard/PretendardVariable.ttf)
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.expanduser('~/Library/Fonts/Pretendard/PretendardVariable.ttf')
W, H = 1200, 630
INK, PRIMARY = (25, 31, 40), (27, 100, 218)

def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_axes([weight])
    return f

img = Image.new('RGB', (W, H), (255, 255, 255))
glow = Image.new('RGB', (W, H), (255, 255, 255))
gd = ImageDraw.Draw(glow)
gd.ellipse([-260, 330, 520, 900], fill=(226, 236, 252))
gd.ellipse([760, -300, 1480, 300], fill=(232, 240, 253))
img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(90)), 1.0)
d = ImageDraw.Draw(img)

icon = Image.open(os.path.join(ROOT, 'apps/admin-web/public/icon-512.png')).convert('RGBA').resize((190, 190), Image.LANCZOS)
img.paste(icon, ((W - 190) // 2, 70), icon)

title = '잇닿 관리자 앱'
tf = font(92, 800)
tw = d.textlength(title, font=tf)
d.text(((W - tw) / 2, 262), title, font=tf, fill=INK)

pill = '▶  영상 보고 바로 설치해요'
pf = font(40, 700)
pw = d.textlength(pill, font=pf)
px, py, ph = (W - pw - 96) / 2, 420, 84
d.rounded_rectangle([px, py, px + pw + 96, py + ph], radius=ph // 2, fill=PRIMARY)
d.text((px + 48, py + 17), pill, font=pf, fill=(255, 255, 255))

sub = '병원·약국·요양병원 · 단기·행사 근무 관리'
sf = font(30, 500)
sw = d.textlength(sub, font=sf)
d.text(((W - sw) / 2, 538), sub, font=sf, fill=(78, 89, 104))

out = os.path.join(ROOT, 'apps/admin-web/public/og/demo.png')
img.save(out, optimize=True)
print(out, img.size, os.path.getsize(out))
