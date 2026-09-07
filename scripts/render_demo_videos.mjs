import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const downloads = path.join(os.homedir(), 'Downloads');
const date = '20260823';

const stories = {
  admin: {
    source: '/private/tmp/atman-video-admin-live',
    output: path.join(downloads, `itdot_admin_demo_${date}_latest.mp4`),
    scenes: [
      ['01-service-intro', '공고부터 지급 확인까지', '빈 근무를 빠르게 채우는 하나의 운영 흐름', '잇닿은 병원, 약국, 요양병원이 빈 근무를 빠르게 채우는 인력 운영 서비스입니다. 공고를 올리고 지원한 워커를 수락한 뒤, 채팅과 출퇴근 기록, 지급 확인까지 한곳에서 이어집니다.'],
      ['02-shift-create', '1. 시프트 생성', '직무와 날짜, 시간만 정하면 공고 준비', '먼저 빈 시간대의 시프트를 만듭니다. 최근 공고 조건을 불러온 뒤, 직무와 날짜, 시작·종료 시간, 시급만 정하면 됩니다.'],
      ['03-applications', '2. 지원 확인과 수락', '지원자를 검토하고 근무를 확정', '워커가 지원하면 이 화면에서 경력과 자격 확인 상태를 보고 수락합니다. 수락과 동시에 워커에게 확정 알림이 갑니다.'],
      ['04-chats', '3. 근무 전 빠른 소통', '확정된 워커와 필요한 내용만 채팅', '수락 뒤에는 바로 채팅이 열립니다. 근무 전 필요한 안내만 빠르게 주고받으면 됩니다.'],
      ['06-attendance-methods', '4. 출근은 시간·현장·기록 순서', '시프트 시간 확인 → GPS·QR·Wi‑Fi 인증 → 즉시 근태 반영', '워커가 출근 버튼을 누르면, 먼저 확정된 시프트와 출근 가능한 시간인지 확인합니다. 그다음 기본 방식인 30미터 위치 원터치를 서버가 검증합니다. 실내처럼 위치가 불안정하면 60초마다 바뀌는 동적 큐알로 보완하고, 등록한 사업장 와이파이도 보완 수단으로 쓸 수 있습니다.'],
      ['05-timesheet', '5. 정상 출근은 바로 반영', '출근 시간·인증 방식·예외만 한 화면에서 확인', '인증을 통과하면 출근 시각과 인증 방식이 관리자 근태에 바로 기록됩니다. 퇴근도 정해 둔 종료시간을 기준으로 처리하고, 조기 퇴근처럼 확인이 필요한 경우만 승인 대상으로 올립니다.'],
      ['02-home', '공고부터 지급 확인까지 한 번에', '워커 모집·출퇴근 기록·입금 확인을 하나의 흐름으로', '공고 하나로 필요한 워커를 구하고, 실제 출퇴근 기록과 입금 확인까지. 잇닿은 인력 운영의 빈틈을 하나의 흐름으로 줄입니다.'],
    ],
  },
  worker: {
    source: '/private/tmp/atman-video-worker-live',
    output: path.join(downloads, `itdot_worker_demo_${date}_latest.mp4`),
    scenes: [
      ['01-worker-intro', '등록하면 바로, 내게 맞는 일자리', '원하는 지역과 시간의 단기근무를 한 앱에서', '잇닿은 워커가 기본 정보를 등록한 뒤 앱을 열면, 원하는 지역과 시간에 맞는 병원, 약국, 요양병원 일자리를 바로 찾아 지원할 수 있는 서비스입니다.'],
      ['02-worker-register', '1. 워커 등록', '카카오로 가입하고 직군 정보를 등록', '처음에는 카카오로 가입한 뒤, 내가 가능한 직군과 기본 정보만 등록합니다.'],
      ['03-activity-area', '2. 활동 지역 활성화', '일할 지역과 이동 반경을 한 번만 설정', '활동 지역을 정하면 내 직군과 반경에 맞는 새 시프트 알림을 받을 수 있습니다.'],
      ['05-shifts', '3. 시프트 확인과 지원', '시간·거리·업무·예상 지급액을 먼저 확인', '시간과 거리, 업무, 시급과 예상 지급액을 확인한 뒤 원하는 공고에만 직접 지원합니다.'],
      ['06-applications', '4. 사업장 수락 후 근무 확정', '지원함 → 채용확정 → 출근예정', '사업장이 수락하면 알림이 오고, 지원 현황에서는 채용 확정과 출근 예정 상태를 한 카드에서 확인합니다.'],
      ['07-chat', '5. 근무 전 채팅', '근무에 필요한 내용만 사업장과 바로 소통', '근무 전 안내나 준비물은 사업장 채팅에서 바로 확인합니다. 연락처를 따로 주고받을 필요가 없습니다.'],
      ['08-workplace', '6. 출근과 퇴근', '시프트 시간 확인 뒤 위치 우선 인증', '근무 당일에는 출근하기를 누릅니다. 정해진 시프트 시간과 현장 위치를 확인하고, 실내에서는 동적 큐알로 보완합니다. 퇴근도 같은 방식으로 기록됩니다.'],
      ['09-payments', '7. 근무 뒤 정산 확인', '실제 근무시간을 바탕으로 사업장이 직접 지급', '퇴근이 완료되면 근무시간을 바탕으로 지급 요청이 생성됩니다. 지급 상태와 입금 확인은 여기에서 확인하고, 지급 일정이나 금액 문의는 근무한 사업장에 직접 확인합니다.'],
      ['10-notifications', '8. 다시 앱을 열면 다음 근무가 보이도록', '새 시프트·채용 확정·채팅·지급 상태를 알림으로 연결', '새 시프트와 채용 확정, 사업장 메시지와 지급 상태는 알림으로 이어집니다. 다음 근무를 놓치지 않고 자연스럽게 다시 시작할 수 있습니다.'],
      ['11-next-shifts', '등록하면 바로, 내게 맞는 일자리', '내 지역·내 시간의 일, 기록과 지급까지 직접 확인', '잇닿에서는 등록 후 앱을 열면 내 지역과 가능한 시간에 맞는 일을 바로 확인할 수 있습니다. 원하는 근무를 고르고, 일한 시간과 지급 상태도 내가 직접 확인합니다.'],
    ],
  },
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function readDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      const duration = Number.parseFloat(output.trim());
      if (code !== 0 || !Number.isFinite(duration)) reject(new Error(`오디오 길이를 확인하지 못했습니다: ${file}`));
      else resolve(duration);
    });
  });
}

async function render(kind) {
  const story = stories[kind];
  const temp = path.join('/private/tmp', `itdot-render-${kind}-${date}`);
  await fs.mkdir(temp, { recursive: true });
  const clips = [];
  const clipDurations = [];
  for (const [index, [imageName, , , narration]] of story.scenes.entries()) {
    const image = path.join(story.source, `${imageName}.png`);
    await fs.access(image);
    const audio = path.join(temp, `${String(index).padStart(2, '0')}.aiff`);
    await run('say', ['-v', 'Yuna', '-r', '205', '-o', audio, narration]);
    const clip = path.join(temp, `${String(index).padStart(2, '0')}.mp4`);
    // Let the narration set the pacing. Do not add a silent tail between
    // scenes; the earlier fixed 9–10 second scenes felt paused and sluggish.
    const narrationDuration = await readDuration(audio);
    const duration = Math.max(4, narrationDuration).toFixed(2);
    const filters = [
      // Keep generous vertical safe space. Mobile players often mask the top
      // and bottom edges with controls or rounded corners.
      `scale=820:-2:flags=lanczos`,
      `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xf5f7fa`,
    ].join(',');
    await run('ffmpeg', ['-y', '-loop', '1', '-i', image, '-i', audio, '-filter_complex', `[0:v]${filters}[v]`, '-map', '[v]', '-map', '1:a', '-af', `apad=whole_dur=${duration}`, '-t', duration, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', clip]);
    clips.push(clip);
    clipDurations.push(Number(duration));
  }

  // The previous concat made every scene fade independently, so the image
  // briefly stopped on a pale frame before the next scene began. Join clips
  // with a short crossfade instead: both the visual and narration stay in one
  // continuous flow without adding a pause.
  // App screens have dense text, so a crossfade makes two screens readable at
  // once. A short directional slide preserves the feeling of navigation
  // without leaving ghosted text on screen.
  const transition = 0.16;
  const inputArgs = clips.flatMap((clip) => ['-i', clip]);
  const graph = [];
  clips.forEach((_, index) => graph.push(`[${index}:v]setpts=PTS-STARTPTS[v${index}]`));
  let elapsed = clipDurations[0];
  let video = 'v0';
  let audio = '0:a';
  for (let index = 1; index < clips.length; index += 1) {
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    const offset = Math.max(0, elapsed - transition).toFixed(2);
    graph.push(`[${video}][v${index}]xfade=transition=slideleft:duration=${transition}:offset=${offset}[${nextVideo}]`);
    graph.push(`[${audio}][${index}:a]acrossfade=d=${transition}:c1=tri:c2=tri[${nextAudio}]`);
    video = nextVideo;
    audio = nextAudio;
    elapsed += clipDurations[index] - transition;
  }
  await run('ffmpeg', ['-y', ...inputArgs, '-filter_complex', graph.join(';'), '-map', `[${video}]`, '-map', `[${audio}]`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', story.output]);
  console.log(story.output);
}

const kind = process.argv[2];
if (!stories[kind]) throw new Error('Usage: node scripts/render_demo_videos.mjs admin|worker');
await render(kind);
