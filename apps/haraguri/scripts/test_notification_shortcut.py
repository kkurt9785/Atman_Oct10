import copy
import importlib.util
import json
import pathlib
import unittest
from shortcut_archive import read_workflow, verify_preserved

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('notification_builder', HERE / 'build-notification-shortcut.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def source_fixture():
    trigger_id = builder.fresh()
    body = builder.token({'Type': 'TriggerOutput', 'TriggerIdentifier': 'WFNotificationTrigger',
                          'Aggrandizements': [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': 'Body'}]})
    return {
        'WFWorkflowTriggers': [{'WFTriggerIdentifier': 'WFNotificationTrigger', 'WFTriggerUUID': trigger_id,
                                'WFTriggerSerializedParameters': {'SelectedApps': [{'BundleIdentifier': 'com.example.private-bank'}], 'Conditions': {}}}],
        'WFWorkflowActions': [builder.post('https://example.invalid/ingest?token=private-member-token', {'body': body})],
    }


class NotificationShortcutTests(unittest.TestCase):
    def test_collector_sends_explicit_title_and_body_properties(self):
        workflow = builder.build_workflow(manual_trigger=True)
        posts = [a for a in workflow['WFWorkflowActions'] if a['WFWorkflowActionIdentifier'].endswith('.downloadurl')]
        fields = posts[-1]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems']
        title = next(f['WFValue'] for f in fields if f['WFKey'] == 'title')
        self.assertEqual(title['Value']['attachmentsByRange']['{0, 1}']['Aggrandizements'][0]['PropertyName'], 'Title')
        self.assertIn('body', [f['WFKey'] for f in fields])

    def test_manual_trigger_file_has_a_real_body_reference_and_no_member_secret(self):
        workflow = builder.build_workflow(manual_trigger=True)
        self.assertNotIn('WFWorkflowTriggers', workflow)
        self.assertNotIn('?token=', json.dumps(workflow))
        text = next(a for a in workflow['WFWorkflowActions'] if a['WFWorkflowActionIdentifier'].endswith('.gettext'))
        self.assertEqual(builder.body_dependencies(text['WFWorkflowActionParameters']['WFTextActionText'], []), [])
        self.assertIn('ios-notification', json.dumps(workflow))
        self.assertIn(builder.STORAGE_KEY, json.dumps(workflow))

    def test_public_file_needs_no_pasted_address_or_import_question(self):
        workflow = builder.build_workflow()
        self.assertEqual(workflow['WFWorkflowImportQuestions'], [])
        self.assertNotIn('?token=', json.dumps(workflow))
        store = next(a for a in workflow['WFWorkflowActions'] if a['WFWorkflowActionIdentifier'].endswith('.setstoredcontent'))
        self.assertEqual(store['WFWorkflowActionParameters']['WFStoredContentKey'], builder.STORAGE_KEY)
        self.assertIs(store['WFWorkflowActionParameters']['WFStoredContentGlobalValue'], True)

    def test_complete_template_preserves_body_and_removes_private_address_and_app_choices(self):
        source = source_fixture()
        original_body = copy.deepcopy(source['WFWorkflowActions'][0]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems'][0]['WFValue'])
        workflow = builder.build_workflow(source)
        text = json.dumps(workflow)
        self.assertNotIn('private-member-token', text)
        self.assertNotIn('com.example.private-bank', text)
        self.assertNotIn('SelectedApps', text)
        self.assertIn(json.dumps(original_body), text)
        self.assertIn('ios-notification', text)

    def test_source_without_a_real_body_variable_is_rejected(self):
        source = source_fixture()
        source['WFWorkflowActions'][0]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems'][0]['WFValue'] = 'literal text'
        with self.assertRaises(ValueError):
            builder.build_workflow(source)

    def test_whole_notification_is_not_an_explicit_body(self):
        source = source_fixture()
        value = source['WFWorkflowActions'][0]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems'][0]['WFValue']
        value['Value']['attachmentsByRange']['{0, 1}'].pop('Aggrandizements')
        with self.assertRaisesRegex(ValueError, '본문'):
            builder.build_workflow(source)

    def test_unused_body_extraction_after_post_does_not_validate_the_post(self):
        source = source_fixture()
        fields = source['WFWorkflowActions'][0]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems']
        body = copy.deepcopy(fields[0]['WFValue'])
        fields[0]['WFValue']['Value']['attachmentsByRange']['{0, 1}'].pop('Aggrandizements')
        source['WFWorkflowActions'].append(builder.action('gettext', WFTextActionText=body))
        with self.assertRaisesRegex(ValueError, '본문'):
            builder.build_workflow(source)

    def test_body_extracted_before_post_is_preserved(self):
        source = source_fixture()
        field = source['WFWorkflowActions'][0]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems'][0]
        text_action = builder.action('gettext', WFTextActionText=copy.deepcopy(field['WFValue']))
        field['WFValue'] = builder.token(builder.output(text_action, 'Text'))
        source['WFWorkflowActions'].insert(0, text_action)
        workflow = builder.build_workflow(source)
        actions = workflow['WFWorkflowActions']
        self.assertIn(text_action, actions)
        target = next(i for i, a in enumerate(actions) if a['WFWorkflowActionIdentifier'].endswith('.downloadurl') and 'ios-notification' in json.dumps(a) and 'ios-notification-setup' not in json.dumps(a))
        self.assertLess(actions.index(text_action), target)

    def test_missing_body_dependency_is_rejected(self):
        source = source_fixture()
        field = source['WFWorkflowActions'][0]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems'][0]
        field['WFValue'] = builder.token({'Type': 'ActionOutput', 'OutputUUID': builder.fresh()})
        with self.assertRaisesRegex(ValueError, '본문'):
            builder.build_workflow(source)

    def test_signer_that_changes_the_extracted_text_is_rejected(self):
        original = {'WFWorkflowActions': [builder.action('gettext', WFTextActionText='expected')]}
        signed = copy.deepcopy(original)
        signed['WFWorkflowActions'][0]['WFWorkflowActionParameters'].pop('WFTextActionText')
        with self.assertRaisesRegex(ValueError, 'WFTextActionText'):
            verify_preserved(original, signed)

    def test_private_address_hidden_in_a_variable_name_is_not_published(self):
        source = source_fixture()
        value = source['WFWorkflowActions'][0]['WFWorkflowActionParameters']['WFJSONValues']['Value']['WFDictionaryFieldValueItems'][0]['WFValue']
        value['Value']['attachmentsByRange']['{0, 1}']['OutputName'] = 'https://example.invalid/?token=private'
        with self.assertRaises(ValueError):
            builder.build_workflow(source)

    def test_signer_that_removes_the_trigger_is_rejected(self):
        workflow = builder.build_workflow(source_fixture())
        stripped = copy.deepcopy(workflow)
        stripped.pop('WFWorkflowTriggers')
        with self.assertRaisesRegex(ValueError, '트리거'):
            verify_preserved(workflow, stripped)

    def test_legacy_public_file_remains_compatible_without_secrets(self):
        legacy = read_workflow(HERE.parent / 'public' / 'haraguri-connect.shortcut')
        self.assertNotRegex(json.dumps(legacy), r'[?&]token=[0-9a-f]{16,}')
        self.assertIn('haraguri.collect.url.v1', json.dumps(legacy))

    def test_v2_stores_token_and_uses_header_on_both_ingest_requests(self):
        workflow = builder.build_workflow(source_fixture())
        posts = [a['WFWorkflowActionParameters'] for a in workflow['WFWorkflowActions'] if a['WFWorkflowActionIdentifier'].endswith('.downloadurl')]
        ingest = [p for p in posts if p['WFURL'] == builder.INGEST_URL]
        self.assertEqual(len(ingest), 2)
        for params in ingest:
            field = params['WFHTTPHeaders']['Value']['WFDictionaryFieldValueItems'][0]
            self.assertEqual(field['WFKey'], 'x-ingest-token')
            self.assertIsInstance(field['WFValue'], dict)
        stores = [a['WFWorkflowActionParameters'] for a in workflow['WFWorkflowActions'] if a['WFWorkflowActionIdentifier'].endswith('.setstoredcontent')]
        self.assertEqual(stores[0]['WFStoredContentKey'], 'haraguri.collect.token.v2')
        self.assertIn('"WFDictionaryKey": "token"', json.dumps(workflow))
        self.assertNotIn('haraguri.collect.url.v1', json.dumps(workflow))

    def test_unlinked_collector_opens_pair_page_instead_of_popup(self):
        workflow = builder.build_workflow(source_fixture())
        self.assertIn('https://haraguri.vercel.app/pair', json.dumps(workflow))
        self.assertNotIn('먼저 하라구리에서', json.dumps(workflow, ensure_ascii=False))

    def test_rebuilding_a_complete_source_skips_the_literal_setup_ping(self):
        first = builder.build_workflow(source_fixture())
        rebuilt = builder.build_workflow(first)
        self.assertEqual(len(rebuilt['WFWorkflowTriggers']), 1)
        self.assertIn('PropertyName', json.dumps(rebuilt))
        self.assertIn('x-ingest-token', json.dumps(rebuilt))

    def test_dictionary_app_selection_is_removed_and_name_is_nfc(self):
        import unicodedata
        source = source_fixture()
        source['WFWorkflowTriggers'][0]['WFTriggerSerializedParameters']['SelectedApps'] = {'Name': 'Private Bank'}
        workflow = builder.build_workflow(source)
        self.assertNotIn('Private Bank', json.dumps(workflow))
        self.assertTrue(unicodedata.is_normalized('NFC', workflow['WFWorkflowName']))


if __name__ == '__main__':
    unittest.main()
