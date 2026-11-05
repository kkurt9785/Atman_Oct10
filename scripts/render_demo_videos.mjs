import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const downloads = path.join(os.homedir(), 'Downloads');
const date = '20261105';

// 장면 = [프레임 파일명, 화면 제목(참고용), 부제(참고용), 나레이션]. 렌더에는 프레임과 나레이션만 쓴다.
// 나레이션 규칙: 해요체, 공고/근무·근무자·출근하기·채용 수수료 0원, '워커·시프트·매칭·간편모드·잇기/닿기' 금지,
// 단기 편은 '사장님'. 화면에 실제로 보이는 것·지금 되는 것만 말한다(docs/demo_video_script_80s.md).
const stories = {
  admin: {
    source: '/private/tmp/atman-video-admin-live',
    output: path.join(downloads, `itdot_admin_demo_${date}_latest.mp4`),
    scenes: [
      ['01-service-intro', '공고부터 지급 확인까지', '빈 근무를 빠르게 채우는 하나의 운영 흐름', '잇닿은 병원, 약국, 요양병원이 빈 근무를 빠르게 채우는 인력 운영 서비스예요. 공고를 올리고 지원한 근무자를 수락한 뒤, 채팅과 출퇴근 기록, 지급 확인까지 한곳에서 이어져요.'],
      ['01-login', '0. 시작은 카카오 로그인 한 번', '사업장 등록은 처음 한 번, 공고는 사업장 확인 뒤', '시작은 카카오 로그인 한 번이면 돼요. 처음 한 번 사업장을 검색해 등록하면 그 위치가 출퇴근 인증의 기준이 되고, 사업장 확인이 끝나면 공고를 올릴 수 있어요. 가입 없이 시연으로 먼저 둘러볼 수도 있어요.'],
      ['02-shift-create', '1. 새 공고', '필요 자격·날짜·시간·시급만 정하면 공고 준비', '빈 근무가 생기면 새 공고를 만들어요. 최근 공고 조건을 불러온 뒤, 필요 자격과 날짜, 시작·종료 시간, 시급만 정하면 돼요.'],
      ['03-applications', '2. 지원 확인과 수락', '경력·자격 확인 상태를 보고 근무 확정', '근무자가 지원하면 지원 현황에서 경력과 자격 확인 상태를 보고 수락해요. 수락하면 근무자에게 채용 확정 알림이 가요.'],
      ['03-cover', '3. 결원은 대타 승인 한 번', '함께 일했던 근무자가 대신 맡겠다고 하면 확정', '확정된 근무자가 못 오게 되면, 이 사업장에서 함께 일했던 근무자가 대타를 신청해요. 사유를 확인하고 대타 확정을 한 번 누르면 근무자가 바뀌어요.'],
      ['04-chat-room', '4. 근무 전 채팅', '확정된 근무자와 필요한 내용만, 근무 끝나고 24시간 뒤 잠김', '수락하면 근무자와 채팅이 바로 열려요. 개인 연락처 없이 근무 전 필요한 안내만 주고받고, 근무가 끝나고 24시간이 지나면 대화가 잠겨요.'],
      ['06-attendance-methods', '5. 출근은 시간·현장·기록 순서', '근무 시간 확인 → 위치·QR·Wi‑Fi 인증 → 바로 근태 반영', '근무자가 출근하기를 누르면 확정된 근무와 출근 가능한 시간인지 먼저 확인하고, 기본 방식인 30미터 위치 원터치를 서버가 확인해요. 실내처럼 위치가 불안정하면 60초마다 바뀌는 동적 큐알이나 등록한 병원 와이파이로 보완해요.'],
      ['05-timesheet', '6. 오늘 근태는 실시간으로', '확인이 필요한 것만 따로', '인증을 통과하면 출근 시각이 오늘 근태에 실시간으로 기록돼요. 조기 퇴근이나 인증 실패처럼 확인이 필요한 경우만 따로 모아서 처리해요.'],
      ['02-home', '공고부터 지급 확인까지 한 번에', '인력 운영 기준·오늘 근무·확인할 업무를 홈 한 화면에', '홈에서는 인력 운영 기준과 오늘 근무 인원, 확인이 필요한 업무를 한눈에 봐요. 공고부터 출퇴근 기록, 지급 확인까지. 잇닿은 인력 운영의 빈틈을 하나의 흐름으로 줄여요.'],
    ],
  },
  worker: {
    source: '/private/tmp/atman-video-worker-live',
    output: path.join(downloads, `itdot_worker_demo_${date}_latest.mp4`),
    scenes: [
      ['01-worker-intro', '내가 가능한 시간, 가까운 근무부터', '병원·약국·요양병원 근무를 한 앱에서', '잇닿 근무자 앱은 기본 정보만 등록하면, 원하는 지역과 시간의 병원, 약국, 요양병원 근무를 찾아 직접 지원할 수 있는 앱이에요.'],
      ['02-worker-register', '1. 근무자 등록', '카카오로 가입하고 직군 정보를 등록', '처음에는 카카오로 가입한 뒤, 내가 가능한 직군과 기본 정보만 등록해요. 가입 전에 근무를 먼저 둘러볼 수도 있어요.'],
      ['03-activity-area', '2. 근무 알림 지역', '일할 지역과 반경을 한 번만 설정', '활동 지역과 반경을 정해 두면 그 지역에 새 근무가 열릴 때 알림을 받아요. 채용 확정과 사업장 메시지도 알림으로 와요.'],
      ['05-shifts', '3. 근무 찾기', '시간·거리·업무·예상 지급액을 한눈에', '근무 찾기에서는 시간과 거리, 업무, 시급과 예상 지급액을 한눈에 비교해요.'],
      ['05-apply-sheet', '4. 조건을 보고 직접 지원', '휴게를 뺀 예상 지급액과 사업장 정보를 한 번 더 확인', '지원하기를 누르면 휴게 시간을 뺀 예상 지급액과 사업장 정보를 한 번 더 확인하고, 원하는 공고에만 직접 지원해요. 사업장이 수락하면 채용 확정으로 바뀌어요.'],
      ['06-applications', '5. 내 근무', '날짜별 일정과 근무 상태', '내 근무에서는 날짜별 일정과 근무 상태를 한눈에 보고, 근무 중이면 맨 위 버튼으로 바로 퇴근할 수 있어요.'],
      ['07-chat', '6. 근무 전 채팅', '근무에 필요한 내용만 사업장과 바로', '근무 전 안내나 준비물은 사업장 채팅에서 바로 확인해요. 연락처를 따로 주고받을 필요가 없고, 근무가 끝나고 24시간이 지나면 대화가 잠겨요.'],
      ['08-workplace', '7. 출근하기 한 번', '길게 눌러 출근·퇴근, 위치는 누른 순간에만', '근무 당일에는 출근하기를 길게 눌러 출근하고, 퇴근도 같은 버튼으로 기록해요. 위치는 누른 순간에만 확인하고, 실내에서는 동적 큐알로 보완해요.'],
      ['09-payments', '8. 지급 확인', '임금은 사업장이 내 계좌로 직접', '퇴근하면 근무 시간을 바탕으로 지급 요청이 만들어져요. 임금은 사업장이 내 계좌로 직접 보내고, 입금 확인은 여기서, 지급 문의는 근무한 사업장에 해요.'],
      ['11-next-shifts', '오늘도, 잇닿과 함께', '다음 내 근무와 출퇴근 버튼, 근무 찾기까지 홈에서', '앱을 열면 다음 내 근무와 출퇴근 버튼이 맨 위에 보이고, 설정한 지역의 근무도 바로 찾아볼 수 있어요. 일한 시간과 지급 상태까지, 잇닿에서 직접 확인해요.'],
    ],
  },
  gig: {
    source: '/private/tmp/atman-video-worker-gig-live',
    output: path.join(downloads, `itdot_gig_demo_${date}_latest.mp4`),
    scenes: [
      ['00-gig-intro', '초대 근무 시연', '팝업·행사 사장님이 초대한 근무', '잇닿 근무자 앱의 초대 근무 화면이에요. 팝업스토어나 행사처럼 사장님이 초대한 근무의 출퇴근 기록과 지급 확인을 한곳에서 해요. 따로 앱을 설치하지 않아도 써 볼 수 있어요.'],
      ['00-gig-invite', '1. 초대 링크 열기', '근무 조건을 먼저 보고 초대 수락', '사장님이 보낸 초대 링크를 열면 근무 기간과 일정, 업무, 급여 조건이 먼저 보여요. 전화번호나 카카오톡 친구 추가 없이, 초대 수락을 누르면 이 근무와 바로 연결돼요.'],
      ['01-gig-home', '2. 출근하기 한 번', '1초 길게 누르면 기록, 필요하면 동적 QR', '근무 당일에는 오늘 근무 화면에서 출근하기를 1초간 길게 누르면 출근이 기록돼요. 위치는 누른 순간에만 확인하고, 실내처럼 위치가 불안정하면 사장님 화면의 동적 큐알로 인증해요. 퇴근도 같은 방식이에요.'],
      ['02-gig-workroom', '3. 사장님과 근무 대화', '공지·출석 확인·근무 메시지를 한곳에', '사장님과 근무 대화에서는 공지와 출석 확인, 근무 메시지를 한곳에서 주고받아요. 개인 전화번호는 보이지 않고, 내 대화는 다른 근무자에게 보이지 않아요.'],
      ['03-gig-settlement', '4. 근태·지급', '지급 계좌 전달 → 내 근태 → 지급 현황', '근태·지급 화면에서는 지급 계좌를 사장님께 전달하고, 내 근태와 지급 현황을 직접 확인해요. 계좌는 이 근무지에서 지급 권한이 있는 사람만 볼 수 있고, 임금은 사장님이 직접 지급해요.'],
      ['05-gig-settings', '초대 링크 하나로 시작', '이 기기 출근 알림 켜기', '앱 설정에서 이 기기의 출근 알림을 켜 두면 근무 30분 전에 안내를 받아요. 초대 링크 하나로 시작하는 단기 근무, 잇닿 근무자 앱 하나면 충분해요.'],
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
if (!stories[kind]) throw new Error('Usage: node scripts/render_demo_videos.mjs admin|worker|gig');
await render(kind);
