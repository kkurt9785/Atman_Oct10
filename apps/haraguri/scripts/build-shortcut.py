#!/usr/bin/env python3
"""Builds and signs the shared "하라구리 수집" Shortcut (public/haraguri-collect.shortcut).

The shortcut has one action — URL 콘텐츠 가져오기 (POST, JSON {"body": <단축어 입력>, "via": "ios-shortcut"}) — and an
import question that asks for the member's collect address on install, so one signed file serves every member.
Users attach it to an automation themselves (iOS 27 알림 trigger, 메시지 trigger, or Apple Pay 거래 trigger): triggers are
not part of a shortcut file and Apple does not let apps create them.

Run on a Mac (signing needs the Shortcuts app's tooling):  python3 scripts/build-shortcut.py
"""
import pathlib, plistlib, subprocess, sys, tempfile, uuid

OBJ = '￼'  # object-replacement character that carries a variable attachment inside a Shortcuts text token
token = lambda s: {'WFSerializationType': 'WFTextTokenString', 'Value': {'string': s}}
shortcut_input = {'WFSerializationType': 'WFTextTokenString', 'Value': {'string': OBJ, 'attachmentsByRange': {'{0, 1}': {'Type': 'ExtensionInput'}}}}

workflow = {
    'WFWorkflowClientVersion': '2607.0.2',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowHasOutputFallback': False,
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59771, 'WFWorkflowIconStartColor': 431817727},
    'WFWorkflowImportQuestions': [{
        'ActionIndex': 0, 'Category': 'Parameter', 'DefaultValue': '', 'ParameterKey': 'WFURL',
        'Text': "하라구리 → 설정 → 가계부 자동 수집에서 복사한 ‘내 수집 주소’를 붙여 넣으세요",
    }],
    'WFWorkflowInputContentItemClasses': [
        'WFAppContentItem', 'WFAppStoreAppContentItem', 'WFArticleContentItem', 'WFContactContentItem', 'WFDateContentItem',
        'WFEmailAddressContentItem', 'WFFolderContentItem', 'WFGenericFileContentItem', 'WFImageContentItem', 'WFiTunesProductContentItem',
        'WFLocationContentItem', 'WFDCMapsLinkContentItem', 'WFAVAssetContentItem', 'WFPDFContentItem', 'WFPhoneNumberContentItem',
        'WFRichTextContentItem', 'WFSafariWebPageContentItem', 'WFStringContentItem', 'WFURLContentItem',
    ],
    'WFWorkflowTypes': ['NCWidget', 'WatchKit'],
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowActions': [{
        'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
        'WFWorkflowActionParameters': {
            'UUID': str(uuid.uuid4()).upper(), 'Advanced': True, 'ShowHeaders': False,
            'WFHTTPMethod': 'POST', 'WFHTTPBodyType': 'JSON',
            'WFURL': 'https://haraguri.vercel.app/',  # replaced by the import question's answer
            'WFJSONValues': {'WFSerializationType': 'WFDictionaryFieldValue', 'Value': {'WFDictionaryFieldValueItems': [
                {'WFItemType': 0, 'WFKey': token('body'), 'WFValue': shortcut_input},
                {'WFItemType': 0, 'WFKey': token('via'), 'WFValue': token('ios-shortcut')},
            ]}},
        },
    }],
}

root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'public' / 'haraguri-collect.shortcut'
with tempfile.TemporaryDirectory() as tmp:
    unsigned = pathlib.Path(tmp) / 'unsigned.shortcut'
    with open(unsigned, 'wb') as f: plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
    subprocess.run(['plutil', '-lint', str(unsigned)], check=True)
    subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', str(unsigned), '--output', str(out)], check=True)
out.chmod(0o644)
print(f'signed → {out} ({out.stat().st_size} bytes)')
