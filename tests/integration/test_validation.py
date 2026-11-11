"""Validation and recovery through the real frozen worker protocol."""
import json
import os
from pathlib import Path
import subprocess

import pytest
from PIL import Image


@pytest.fixture
def worker_binary():
    binary = Path(os.environ.get('CARD_MAKER_PDF_WORKER', '/app/pdf_worker'))
    if not binary.is_file():
        pytest.skip('Set CARD_MAKER_PDF_WORKER or run in the native integration container.')
    return str(binary)


@pytest.mark.parametrize('args', [
    ['--card_size', 'does-not-exist'],
    ['--paper_size', 'does-not-exist'],
    ['--ppi', '-1'],
    ['--ppi', '0'],
    ['--ppi', 'abc'],
    ['--quality', '101'],
    ['--quality', '-1'],
    ['--registration', 'invalid'],
    ['--unknown-option'],
])
def test_invalid_options_then_successful_request(tmp_path, args, worker_binary):
    env = dict(os.environ)
    for name in ['front', 'back', 'double_sided', 'output', 'data']:
        directory = tmp_path / name
        directory.mkdir()
        env[f'CARD_MAKER_{name.upper()}_DIR'] = str(directory)
    Image.new('RGB', (63, 88), 'navy').save(tmp_path / 'front' / 'card.png')
    requests = [
        {'command': 'create_pdf', 'args': args},
        {'command': 'create_pdf', 'args': ['--only_fronts', '--ppi', '72']},
    ]
    result = subprocess.run([worker_binary], input=''.join(json.dumps(r) + '\n' for r in requests), env=env, cwd=tmp_path, text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr
    ready, invalid, recovered = map(json.loads, result.stdout.splitlines())
    assert ready == {'ready': True}
    assert invalid['ok'] is False and invalid['error']
    assert recovered['ok'] is True, recovered
    assert (tmp_path / 'output' / 'game.pdf').read_bytes().startswith(b'%PDF')


def test_malformed_protocol_then_recovery(tmp_path, worker_binary):
    result = subprocess.run([worker_binary], input='not json\n' + json.dumps({'command': 'unknown'}) + '\n', cwd=tmp_path, text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr
    replies = [json.loads(line) for line in result.stdout.splitlines()]
    assert replies[0] == {'ready': True}
    assert len(replies) == 3
    assert all(not reply['ok'] and reply['error'] for reply in replies[1:])


@pytest.mark.parametrize('scenario', ['empty', 'corrupt', 'missing-directory'])
def test_bad_front_inputs_report_errors_without_pdf(tmp_path, scenario, worker_binary):
    env = dict(os.environ)
    for name in ['front', 'back', 'double_sided', 'output', 'data']:
        directory = tmp_path / name
        directory.mkdir()
        env[f'CARD_MAKER_{name.upper()}_DIR'] = str(directory)
    if scenario == 'corrupt':
        (tmp_path / 'front' / 'bad.png').write_bytes(b'not an image')
    elif scenario == 'missing-directory':
        (tmp_path / 'front').rmdir()
    request = {'command': 'create_pdf', 'args': ['--only_fronts', '--ppi', '72']}
    result = subprocess.run([worker_binary], input=json.dumps(request) + '\n', env=env, cwd=tmp_path, text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr
    ready, response = map(json.loads, result.stdout.splitlines())
    assert ready == {'ready': True}
    assert response['ok'] is False and response['error'], response
    assert not (tmp_path / 'output' / 'game.pdf').exists()


def test_saved_fractional_offsets_are_used(tmp_path, monkeypatch):
    import utilities
    monkeypatch.setattr(utilities, 'DATA_DIR', tmp_path)
    (tmp_path / 'offset_data.json').write_text(json.dumps(dict(x_offset=2.25, y_offset=-1.5, angle_offset=0.25)))
    saved = utilities.load_saved_offset()
    assert (saved.x_offset, saved.y_offset, saved.angle_offset) == (2.25, -1.5, 0.25)
