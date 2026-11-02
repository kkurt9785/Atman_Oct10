#!/usr/bin/env python3
"""Inspect a shared iCloud shortcut link without installing it.

Usage: python3 scripts/inspect-icloud-shortcut.py https://www.icloud.com/shortcuts/<id>
Prints: signing status, triggers (identifier, selected apps, conditions), action list,
whether any ingest token or private URL is embedded. Read-only; nothing is uploaded.
"""
import json, plistlib, re, sys, urllib.request, unicodedata

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read()

def main():
    if len(sys.argv) != 2 or '/shortcuts/' not in sys.argv[1]:
        sys.exit(__doc__)
    sid = re.search(r'/shortcuts/(?:api/records/)?([0-9a-f]{32})', sys.argv[1])
    if not sid:
        sys.exit('iCloud 단축어 링크가 아닙니다.')
    rec = json.loads(fetch(f'https://www.icloud.com/shortcuts/api/records/{sid.group(1)}'))
    f = rec.get('fields', {})
    print('name:', f.get('name', {}).get('value'), '| signingStatus:', f.get('signingStatus', {}).get('value'))
    name = f.get('name', {}).get('value', '')
    print('name NFC:', unicodedata.is_normalized('NFC', name), '| NFD:', unicodedata.is_normalized('NFD', name), '| code points:', len(name))
    if not unicodedata.is_normalized('NFC', name): print('WARNING: rename the shortcut with the iPhone keyboard to NFC before sharing.')
    wf = plistlib.loads(fetch(f['shortcut']['value']['downloadURL']))
    triggers = wf.get('WFWorkflowTriggers') or []
    print('triggers:', len(triggers))
    for t in triggers:
        p = t.get('WFTriggerSerializedParameters', {})
        apps = p.get('SelectedApps')
        apps = apps if isinstance(apps, list) else [apps] if apps else []
        names = [a.get('Name') if isinstance(a, dict) else a for a in apps]
        print('  -', t.get('WFTriggerIdentifier'), '| apps:', names, '| conditions:', json.dumps(p.get('Conditions'), ensure_ascii=False)[:120])
    acts = [a['WFWorkflowActionIdentifier'].split('.')[-1] for a in wf.get('WFWorkflowActions', [])]
    print('actions (%d):' % len(acts), acts)
    s = json.dumps(wf, default=str, ensure_ascii=False)
    print('import questions:', len(wf.get('WFWorkflowImportQuestions', [])), '| min client:', wf.get('WFWorkflowMinimumClientVersionString'))
    print('body refs:', sorted(set(re.findall(r'"PropertyName": "([^"]+)"', s))), '| stored-content key:', 'haraguri.collect.url.v1' in s)
    leak = re.search(r'[?&]token=[0-9a-f]{16,}', s) or re.search(r'(?<![0-9a-f])[0-9a-f]{48,128}(?![0-9a-f])', s)
    print('TOKEN LEAK:' if leak else 'token embedded:', bool(leak))
    urls = sorted(set(re.sub(r'token=[0-9a-f]+', 'token=<redacted>', u) for u in re.findall(r'https?://[^"\\\s]+', s)))
    print('urls:', ['<private URLs redacted>' ] if leak else urls)

if __name__ == '__main__':
    main()
