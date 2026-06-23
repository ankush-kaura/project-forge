import importlib.util
from pathlib import Path


def load_bot():
    spec = importlib.util.spec_from_file_location('bot', Path(__file__).with_name('bot.py'))
    bot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bot)
    return bot


def run_message(text):
    bot = load_bot()
    outputs = []
    def send(chat_id, msg, parse_mode='Markdown'):
        outputs.append(msg)
    bot.send_message = send
    routed = []
    def make(name):
        def handler(chat_id, args=''):
            routed.append((name, args))
        return handler
    for name in [
        'handle_brainstorm','handle_choose','handle_approve_arch','handle_start_qa',
        'handle_confirm_answers','handle_build_status','handle_approve_layer','handle_build',
        'handle_push','handle_refine','handle_forge','handle_approve','handle_forgehealth',
        'handle_list','handle_help','handle_status','handle_new'
    ]:
        setattr(bot, name, make(name))
    bot.handle_message({'message': {'chat': {'id': 1}, 'from': {'id': '123456789'}, 'text': text}})
    return routed, outputs


def test_botname_suffix_preserves_args():
    routed, _ = run_message('/brainstorm@ProjectForgeBot abc123')
    assert routed == [('handle_brainstorm', 'abc123')]


def test_underscore_aliases_route_to_real_handlers():
    cases = {
        '/approve_arch sid': ('handle_approve_arch', 'sid'),
        '/start_qa sid': ('handle_start_qa', 'sid'),
        '/confirm_answers sid': ('handle_confirm_answers', 'sid'),
        '/build_status sid': ('handle_build_status', 'sid'),
        '/approve_layer sid api_backend': ('handle_approve_layer', 'sid api_backend'),
    }
    for text, expected in cases.items():
        routed, _ = run_message(text)
        assert routed == [expected]


def test_plain_command_word_not_saved_as_idea():
    routed, outputs = run_message('brainstorm abc123')
    assert routed == []
    assert outputs and '`/brainstorm <idea-id>`' in outputs[0]


def test_build_sets_valid_backend_layers(monkeypatch):
    bot = load_bot()
    calls = []
    def fake_api(method, endpoint, data=None, timeout=30):
        calls.append((method, endpoint, data))
        if endpoint.endswith('/layers'):
            return {'data': {'layers': data['layers']}}
        return {'data': {'status': 'started', 'layers': []}}
    bot.strapi_api = fake_api
    outputs = []
    bot.send_message = lambda chat_id, text, parse_mode='Markdown': outputs.append(text)
    bot.handle_build(1, 'session123')
    layer_call = next(c for c in calls if c[1] == 'brainstorm/session123/layers')
    assert layer_call[2]['layers'] == ['database_schema', 'api_backend', 'frontend', 'auth', 'docker', 'tests', 'docs']


def test_brainstorm_reads_backend_v2_shape_and_preserves_full_session_id(monkeypatch):
    bot = load_bot()
    full_session = 'abcdef1234567890fullsession'
    bot.resolve_idea_id = lambda raw: ('idea123', None)
    bot.strapi_api = lambda method, endpoint, data=None, timeout=30: {
        'data': {
            'session_id': full_session,
            'architecture_proposal': {
                'options': [{'name': 'React SPA', 'description': 'Fast MVP'}]
            }
        }
    }
    outputs = []
    bot.send_message = lambda chat_id, text, parse_mode='Markdown': outputs.append(text)
    bot.handle_brainstorm(1, 'idea123')
    assert full_session in outputs[-1]
    assert 'React SPA' in outputs[-1]
    assert full_session[:12] + ' <number>' not in outputs[-1]


def test_qa_question_uses_strapi_question_text_field(monkeypatch):
    bot = load_bot()
    bot._qa_state[1] = {
        'session_id': 'sid',
        'index': 0,
        'questions': [{'documentId': 'qid', 'question_text': 'What theme?', 'options': ['Light', 'Dark']}],
    }
    outputs = []
    bot.send_message = lambda chat_id, text, parse_mode='Markdown': outputs.append(text)
    bot._send_qa_question(1)
    assert 'What theme?' in outputs[-1]


def test_status_uses_active_brainstorm_lookup_by_idea_id(monkeypatch):
    bot = load_bot()
    setattr(bot, 'resolve_idea_id', lambda raw: ('idea123', None))
    setattr(bot, 'strapi_get_idea', lambda doc_id: {
        'documentId': doc_id,
        'title': 'Demo idea',
        'status': 'brainstorming',
        'category': 'other',
        'source': 'telegram',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'description': 'Demo',
        'tags': [],
    })
    calls = []
    def fake_api(method, endpoint, data=None, timeout=30):
        calls.append((method, endpoint))
        if endpoint == 'brainstorm/idea/idea123/active':
            return {'data': {'documentId': 'fullsession123456', 'status': 'awaiting_plan_approval'}}
        return {'data': None}
    setattr(bot, 'strapi_api', fake_api)
    outputs = []
    setattr(bot, 'send_message', lambda chat_id, text, parse_mode='Markdown': outputs.append(text))
    bot.handle_status(1, 'idea123')
    assert ('GET', 'brainstorm/idea/idea123/active') in calls
    assert 'fullsession123456' in outputs[-1]


def test_user_facing_usage_prefers_telegram_safe_underscore_commands():
    bot = load_bot()
    outputs = []
    setattr(bot, 'send_message', lambda chat_id, text, parse_mode='Markdown': outputs.append(text))
    bot.handle_approve_arch(1, '')
    bot.handle_start_qa(1, '')
    bot.handle_confirm_answers(1, '')
    bot.handle_build_status(1, '')
    bot.handle_approve_layer(1, '')
    combined = '\n'.join(outputs)
    assert '/approve_arch' in combined
    assert '/start_qa' in combined
    assert '/confirm_answers' in combined
    assert '/build_status' in combined
    assert '/approve_layer' in combined
    assert '/approve-arch' not in combined
    assert '/start-qa' not in combined
    assert '/confirm-answers' not in combined
    assert '/build-status' not in combined
    assert '/approve-layer' not in combined
