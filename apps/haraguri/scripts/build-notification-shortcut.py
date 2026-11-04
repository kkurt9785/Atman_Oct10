#!/usr/bin/env python3
"""Build a public pairing Shortcut or a notification collector.

The public file never contains a member's collection token. Pairing uses a
five-minute code supplied by the app and Shortcuts' OS 27 Stored Content actions.
Manual-trigger mode includes all collector actions and the observed iOS body
reference; the recipient adds the notification card. Embedded-trigger mode
requires a real iOS export. Distribution uses an iPhone iCloud share; Mac signing is intentionally unavailable.
"""
import argparse
import copy
import json
import pathlib
import plistlib
import re
import uuid
from shortcut_archive import read_workflow

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAIR_URL = 'https://rwyvqxkweqsoositvlht.supabase.co/functions/v1/shortcut-pair'
STORAGE_KEY = 'haraguri.collect.token.v2'
INGEST_URL = 'https://rwyvqxkweqsoositvlht.supabase.co/functions/v1/ingest'
OBJ = '\ufffc'


def fresh():
    return str(uuid.uuid4()).upper()


def token(reference):
    return {'WFSerializationType': 'WFTextTokenString', 'Value': {'string': OBJ, 'attachmentsByRange': {'{0, 1}': reference}}}


def attachment(reference):
    return {'WFSerializationType': 'WFTextTokenAttachment', 'Value': reference}


def output(action, name='Result'):
    return {'Type': 'ActionOutput', 'OutputUUID': action['WFWorkflowActionParameters']['UUID'], 'OutputName': name}


def action(identifier, **parameters):
    return {'WFWorkflowActionIdentifier': 'is.workflow.actions.' + identifier, 'WFWorkflowActionParameters': {'UUID': fresh(), **parameters}}


def post(url, fields, ingest_token=None):
    items = [{'WFItemType': 0, 'WFKey': key, 'WFValue': value} for key, value in fields.items()]
    headers = {}
    if ingest_token is not None:
        headers['WFHTTPHeaders'] = {'WFSerializationType': 'WFDictionaryFieldValue', 'Value': {'WFDictionaryFieldValueItems': [{'WFItemType': 0, 'WFKey': 'x-ingest-token', 'WFValue': ingest_token}]}}
    return action('downloadurl', WFURL=url, WFHTTPMethod='POST', WFHTTPBodyType='JSON', WFJSONValues={'WFSerializationType': 'WFDictionaryFieldValue', 'Value': {'WFDictionaryFieldValueItems': items}}, **headers)


def conditional(reference):
    group = fresh()
    start = action('conditional', GroupingIdentifier=group, WFControlFlowMode=0, WFCondition=100,
                   WFInput={'Type': 'Variable', 'Variable': attachment(reference)})
    middle = action('conditional', GroupingIdentifier=group, WFControlFlowMode=1)
    end = action('conditional', GroupingIdentifier=group, WFControlFlowMode=2)
    return start, middle, end


def body_dependencies(value, preceding_actions):
    """Accept an explicit Notification.Body, directly or through earlier Text actions.

    A whole Notification token is not proof that its body will be sent. A Text
    action placed after the POST does not supply the POST's input either.
    """
    reference = None
    if isinstance(value, dict):
        if value.get('WFSerializationType') == 'WFTextTokenAttachment':
            reference = value.get('Value')
        elif value.get('WFSerializationType') == 'WFTextTokenString':
            content = value.get('Value', {})
            if content.get('string') == OBJ:
                reference = content.get('attachmentsByRange', {}).get('{0, 1}')
    if isinstance(reference, dict):
        body_property = any(p.get('Type') == 'WFPropertyVariableAggrandizement' and p.get('PropertyName') == 'Body'
                            for p in reference.get('Aggrandizements', []) if isinstance(p, dict))
        if reference.get('Type') == 'TriggerOutput' and reference.get('TriggerIdentifier') == 'WFNotificationTrigger' and body_property:
            return []
        if reference.get('Type') == 'ActionOutput':
            for index, candidate in enumerate(preceding_actions):
                params = candidate.get('WFWorkflowActionParameters', {})
                if params.get('UUID') != reference.get('OutputUUID'):
                    continue
                if candidate.get('WFWorkflowActionIdentifier') != 'is.workflow.actions.gettext':
                    raise ValueError('알림 본문 앞의 사용자 정의 동작을 검토해야 합니다.')
                dependencies = body_dependencies(params.get('WFTextActionText'), preceding_actions[:index])
                return [*dependencies, copy.deepcopy(candidate)]
    raise ValueError('POST의 body에 알림 → 본문 변수를 지정해야 합니다. 전송 뒤의 본문 추출 동작은 연결되지 않습니다.')


def source_notification(source):
    triggers = copy.deepcopy(source.get('WFWorkflowTriggers', []))
    if len(triggers) != 1 or triggers[0].get('WFTriggerIdentifier') != 'WFNotificationTrigger':
        raise ValueError('알림 트리거가 하나 있는 iOS 27 내보내기 파일이 필요합니다.')
    # App selection is performed on the recipient's phone, never copied from
    # the author's financial-app choices. Keep the observed empty-filter shape.
    triggers[0].setdefault('WFTriggerSerializedParameters', {}).pop('SelectedApps', None)
    actions = source.get('WFWorkflowActions', [])
    for index, item in enumerate(actions):
        if item.get('WFWorkflowActionIdentifier') != 'is.workflow.actions.downloadurl':
            continue
        params = item.get('WFWorkflowActionParameters', {})
        if params.get('WFHTTPMethod') != 'POST' or params.get('WFHTTPBodyType') not in (None, 'JSON'):
            continue
        fields = params.get('WFJSONValues', {}).get('Value', {}).get('WFDictionaryFieldValueItems', [])
        def literal(value):
            return value.get('Value', {}).get('string') if isinstance(value, dict) else value
        # A complete source also contains a pairing test POST before the real
        # notification request. It is intentionally literal, not a body source.
        if any(literal(f.get('WFKey')) == 'via' and literal(f.get('WFValue')) == 'ios-notification-setup' for f in fields):
            continue
        for field in fields:
            key = field.get('WFKey')
            if isinstance(key, dict):
                key = key.get('Value', {}).get('string')
            if key != 'body':
                continue
            body = copy.deepcopy(field.get('WFValue'))
            prefix = body_dependencies(body, actions[:index])
            return triggers, prefix, body
    raise ValueError('POST JSON body에 연결된 알림 본문을 찾지 못했습니다.')


def build_workflow(source=None, manual_trigger=False):
    if source is not None and manual_trigger:
        raise ValueError('원본 트리거 보존 방식과 직접 추가 방식을 동시에 사용할 수 없습니다.')
    shortcut_input = {'Type': 'ExtensionInput'}
    match = action('text.match', text=token(shortcut_input), WFMatchTextPattern='^[0-9a-f]{48}$', WFMatchTextCaseSensitive=True)
    start, otherwise, end = conditional(output(match, 'Matches'))
    claim = post(PAIR_URL, {'code': token(output(match, 'Matches'))})
    collect_url = action('getvalueforkey', WFGetDictionaryValueType='Value', WFDictionaryKey='token', WFInput=attachment(output(claim, 'Contents of URL')))
    valid, invalid, valid_end = conditional(output(collect_url, 'Dictionary Value'))
    # The Stored Content input is a text field: iOS 27 only binds a WFTextTokenString here. A bare attachment
    # (as other actions take) shows an empty '콘텐츠' slot on device, so pairing "completes" without storing anything
    # and every notification then takes the not-linked branch (seen 11/4, fixed by hand in the editor).
    store = action('setstoredcontent', WFInput=token(output(collect_url, 'Dictionary Value')), WFStoredContentKey=STORAGE_KEY, WFStoredContentGlobalValue=True)
    ping = post(INGEST_URL, {'body': '하라구리 연결 테스트', 'via': 'ios-notification-setup'}, token(output(collect_url, 'Dictionary Value')))
    actions = [match, start, claim, collect_url, valid, store, ping,
               action('showresult', Text='하라구리 계정 연결이 완료됐어요. 실제 앱 알림 수신 확인은 별도로 진행해 주세요.'),
               invalid, action('showresult', Text='연결 코드가 만료됐어요. 하라구리에서 내 계정 연결을 다시 눌러 주세요.'), valid_end, otherwise]
    triggers = []
    if source is not None or manual_trigger:
        if source is not None:
            triggers, prefix, body = source_notification(source)
        else:
            # Encoding observed in the user's real iOS export. No trigger UUID
            # is required: iOS resolves this against the notification card that
            # the recipient adds in the editor.
            prefix = []
            body = token({'Type': 'TriggerOutput', 'TriggerIdentifier': 'WFNotificationTrigger',
                          'Aggrandizements': [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': 'Body'}]})
        stored = action('getstoredcontent', WFStoredContentKey=STORAGE_KEY, WFStoredContentGlobalValue=True)
        linked, unlinked, linked_end = conditional(output(stored, 'Stored Content'))
        text = action('gettext', WFTextActionText=body)
        title = token({'Type': 'TriggerOutput', 'TriggerIdentifier': 'WFNotificationTrigger',
                       'Aggrandizements': [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': 'Title'}]})
        combined = action('gettext', WFTextActionText={'WFSerializationType': 'WFTextTokenString', 'Value': {
            'string': OBJ + '\n' + OBJ, 'attachmentsByRange': {
                '{0, 1}': title['Value']['attachmentsByRange']['{0, 1}'], '{2, 1}': output(text, 'Text')}}})
        present, _, present_end = conditional(output(combined, 'Text'))
        actions.extend([stored, linked, *prefix, text, combined, present,
                        post(INGEST_URL, {'title': title, 'body': token(output(text, 'Text')), 'via': 'ios-notification'}, token(output(stored, 'Stored Content'))), present_end,
                        unlinked, linked_end])  # not linked yet: stay silent — the app's 가계부 card tells the user what to do
    else:
        actions.append(action('showresult', Text='하라구리 설정에서 내 계정 연결 버튼으로 실행해 주세요.'))
    actions.append(end)
    workflow = {
        'WFWorkflowName': ('하라구리 알림 수집' if source is not None or manual_trigger else '하라구리 계정 연결'),
        'WFWorkflowClientVersion': '2607.0.2', 'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900', 'WFWorkflowHasOutputFallback': False,
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59771, 'WFWorkflowIconStartColor': 431817727},
        'WFWorkflowImportQuestions': [], 'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
        'WFWorkflowOutputContentItemClasses': [], 'WFWorkflowTypes': [], 'WFWorkflowActions': actions,
        # Running the shortcut by hand (no input) reads the pairing code from the clipboard, so the app's
        # "연결 코드 복사" path works without any shortcuts:// link or name lookup. Verify on device.
        'WFWorkflowNoInputBehavior': {'Name': 'WFWorkflowNoInputBehaviorGetClipboard', 'Parameters': {}},
    }
    if triggers:
        workflow['WFWorkflowTriggers'] = triggers
    # A private source export must never leak its collection URL via a variable name.
    if re.search(r'[?&]token=|service_role|SUPABASE_SERVICE_ROLE_KEY', json.dumps(workflow)):
        raise ValueError('개인 수집 주소가 남아 있어 배포 파일 생성을 중단했습니다.')
    return workflow


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, help='Private iOS 27 export; never uploaded or copied to public')
    parser.add_argument('--manual-trigger', action='store_true', help='Build all collector actions; the recipient adds the notification card on iPhone')
    parser.add_argument('--unsigned-output', type=pathlib.Path, required=True, help='Write a reviewable workflow for iPhone import and iCloud sharing; never sign on Mac')
    args = parser.parse_args()
    source = read_workflow(args.source) if args.source else None
    workflow = build_workflow(source, manual_trigger=args.manual_trigger)
    args.unsigned_output.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_XML))
    print('Unsigned workflow generated. Import and verify on iOS 27, then share a token-free iCloud copy. App release unchanged.')


if __name__ == '__main__':
    main()
