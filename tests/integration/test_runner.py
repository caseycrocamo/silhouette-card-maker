"""Check isolation and cleanup when a test fails or times out."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest


def load_runner():
    spec = importlib.util.spec_from_file_location('isolated_runner', Path(__file__).resolve().parents[2] / 'scripts/test-integration.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('timeout', [False, True])
def test_each_case_has_a_new_container_and_cleanup_before_next_case(monkeypatch, tmp_path, timeout):
    module = load_runner()
    cases = [dict(suite='worker', name='first'), dict(suite='worker', name='second')]
    calls = []
    monkeypatch.setattr(sys, 'argv', ['runner', '--no-build', '--results', str(tmp_path / 'results.json')])
    monkeypatch.setattr(module.subprocess, 'check_output', lambda command, **kw: 'sha256:fixed-image' if command[1] == 'image' else 'CASES=' + json.dumps(cases))

    def run(command, **kwargs):
        calls.append(command)
        if command[1] == 'run' and json.loads(command[-1])['name'] == 'first':
            if timeout:
                raise subprocess.TimeoutExpired(command, 210)
            return SimpleNamespace(returncode=1)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(module.subprocess, 'run', run)
    assert module.main() == 1
    assert [c[1] for c in calls] == ['run', 'rm', 'run', 'rm']
    names = [c[c.index('--name') + 1] for c in calls if c[1] == 'run']
    assert names[0] != names[1]
    for index, command in enumerate(calls[::2]):
        assert '--rm' in command and '--network=none' in command
        assert command[-2] == 'sha256:fixed-image'
        assert not any(flag in command for flag in ['-v', '--mount', '--volume'])
        assert calls[index * 2 + 1] == ['docker', 'rm', '-f', names[index]]
    results = json.loads((tmp_path / 'results.json').read_text())
    assert results[0]['returncode'] == (124 if timeout else 1)
    assert results[1]['returncode'] == 0
