// HARAGURI AI recognition for ledger screenshots. Optional: only answers when ANTHROPIC_API_KEY is set (scripts/setup-vision-secret.sh).
// The image is read once, sent to Claude, and discarded — nothing is stored. Callers must be signed-in family members (JWT verified by the gateway).
import Anthropic from 'npm:@anthropic-ai/sdk@0.90.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Row = { date: string; merchant: string; amount: number; cancel: boolean; raw: string };

const PROMPT = `이 이미지는 카드사·은행·간편결제 앱의 이용내역(거래 목록) 화면 캡처입니다. 화면에 보이는 개별 거래를 모두 추출하세요.
규칙:
- 각 거래: date(YYYY-MM-DD, 연도가 안 보이면 ${new Date().getFullYear()}년으로 하되 오늘보다 미래면 작년), merchant(가맹점·내용, 라벨 제거), amount(원 단위 정수; 취소·환불은 음수), cancel(취소/환불이면 true).
- 잔액·누적·합계·이용한도·결제예정·포인트 같은 요약 줄은 제외.
- 할부 표기(예: 3개월)는 merchant에 넣지 말고 amount는 표시된 금액 그대로.
- 확실하지 않은 숫자는 추측하지 말고 그 거래를 빼세요.
오직 JSON 배열만 출력하세요. 예: [{"date":"2026-10-27","merchant":"스타벅스 역삼점","amount":4500,"cancel":false}]`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (req.method === 'GET') return json({ configured: !!apiKey }); // the app shows the AI button only when this says yes
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!apiKey) return json({ error: 'AI recognition is not configured' }, 503);
  const form = await req.formData().catch(() => null);
  const image = form?.get('image');
  if (!(image instanceof File)) return json({ error: 'image file required' }, 400);
  if (image.size > 8 * 1024 * 1024) return json({ error: 'image too large (8MB)' }, 413);
  const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const).find(t => t === image.type) ?? 'image/jpeg';
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(binary);

  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: PROMPT }] }],
    });
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
    const start = text.indexOf('['), end = text.lastIndexOf(']');
    const parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) as Partial<Row>[] : [];
    const rows: Row[] = parsed
      .filter(r => r && typeof r.merchant === 'string' && Number.isFinite(Number(r.amount)) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)))
      .map(r => ({ date: String(r.date), merchant: String(r.merchant).trim().slice(0, 200), amount: Math.round(Number(r.amount)), cancel: !!r.cancel || Number(r.amount) < 0, raw: 'ai' }))
      .filter(r => r.amount !== 0 && Math.abs(r.amount) <= 100000000);
    return json({ rows, usage: { input: message.usage.input_tokens, output: message.usage.output_tokens } });
  } catch (e) {
    console.error('vision failed', e);
    return json({ error: 'recognition failed' }, 502);
  }
});
