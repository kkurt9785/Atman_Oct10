"""Apply HARAGURI auth settings without printing provider credentials."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parents[1]
assert (root / 'supabase/.temp/project-ref').read_text().strip() == 'rwyvqxkweqsoositvlht'
env = os.environ.copy()
secrets = []
for line in (root / '.env.kakao').read_text().splitlines():
    key, value = line.split('=', 1)
    env[key] = value
    secrets.append(value)
result = subprocess.run(['supabase', 'config', 'push', '--workdir', str(root), '--project-ref', 'rwyvqxkweqsoositvlht', '--yes'], env=env, capture_output=True, text=True, timeout=90)
if result.returncode == 0:
    print('HARAGURI Kakao provider configuration verified.')
else:
    output = result.stdout + result.stderr
    for value in secrets:
        output = output.replace(value, '[REDACTED]')
    print(output[-1800:])
raise SystemExit(result.returncode)
