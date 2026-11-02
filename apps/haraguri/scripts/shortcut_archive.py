"""Read a supplied Shortcut file and verify that signing preserves its contents.

Only the exported file is read; the live Shortcuts database is never accessed.
"""
import pathlib
import plistlib
import struct
import subprocess
import tempfile


def read_workflow(path):
    path = pathlib.Path(path).resolve()
    data = path.read_bytes()
    if len(data) > 16 * 1024 * 1024:
        raise ValueError('Shortcut file is too large')
    if not data.startswith(b'AEA1'):
        return plistlib.loads(data)
    size = struct.unpack_from('<I', data, 8)[0]
    metadata = plistlib.loads(data[12:12 + size])
    certificate = metadata['SigningCertificateChain'][0]
    pem = subprocess.run(['openssl', 'x509', '-inform', 'DER', '-pubkey', '-noout'], input=certificate, check=True, capture_output=True).stdout
    der = subprocess.run(['openssl', 'pkey', '-pubin', '-outform', 'DER'], input=pem, check=True, capture_output=True).stdout
    public_key = der[-65:]
    if len(public_key) != 65 or public_key[0] != 4:
        raise ValueError('Unexpected signing public key format')
    with tempfile.TemporaryDirectory(prefix='haraguri-shortcut-') as tmp:
        archive = pathlib.Path(tmp) / 'content.aar'
        subprocess.run(['aea', 'decrypt', '-i', str(path), '-o', str(archive), '-sign-pub-value', 'hex:' + public_key.hex()], check=True, capture_output=True)
        subprocess.run(['aa', 'extract', '-i', str(archive), '-d', tmp, '-include-path', 'Shortcut.wflow'], check=True, capture_output=True)
        return plistlib.loads((pathlib.Path(tmp) / 'Shortcut.wflow').read_bytes())


def verify_preserved(original, signed):
    if original.get('WFWorkflowTriggers', []) != signed.get('WFWorkflowTriggers', []):
        raise ValueError('서명 과정에서 알림 트리거가 변경됐습니다. OS 27 서명 환경이 필요합니다.')
    before = original['WFWorkflowActions']
    after = signed['WFWorkflowActions']
    if [a['WFWorkflowActionIdentifier'] for a in before] != [a['WFWorkflowActionIdentifier'] for a in after]:
        raise ValueError('서명 과정에서 단축어 동작이 변경됐습니다.')
    for src, dst in zip(before, after):
        source = src.get('WFWorkflowActionParameters', {})
        actual = dst.get('WFWorkflowActionParameters', {})
        for key in ('WFStoredContentKey', 'WFStoredContentGlobalValue', 'WFJSONValues', 'WFURL', 'WFInput', 'WFTextActionText', 'WFHTTPMethod', 'WFHTTPBodyType', 'WFCondition', 'WFControlFlowMode', 'text', 'WFMatchTextPattern', 'WFDictionaryKey'):
            if key in source and source[key] != actual.get(key):
                raise ValueError('서명 과정에서 연결 설정이 변경됐습니다: ' + key)
