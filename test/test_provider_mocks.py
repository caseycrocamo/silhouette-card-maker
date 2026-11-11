"""Check that missing mocks fail, including errors caught by deck parsers."""
from pathlib import Path
import subprocess
import sys

import pytest

from provider_mocks import ProviderMocks


def test_unknown_provider_endpoint_has_no_network_fallback():
    with pytest.raises(AssertionError, match='Unmocked provider endpoint'):
        ProviderMocks().request('GET', 'https://unknown.example/cards')


@pytest.mark.parametrize('swallow_error', [False, True])
def test_network_guard_reports_requests_even_when_errors_are_caught(tmp_path, swallow_error):
    root = Path(__file__).resolve().parents[1]
    (tmp_path / 'conftest.py').write_text((root / 'conftest.py').read_text(encoding='utf-8'), encoding='utf-8')
    (tmp_path / 'provider_mocks.py').write_text((root / 'test/provider_mocks.py').read_text(encoding='utf-8'), encoding='utf-8')
    (tmp_path / 'test_network.py').write_text('''
import requests

def test_unmocked_request(monkeypatch):
    # This sentinel also prevents network traffic if the outer guard breaks.
    def transport(*args, **kwargs):
        raise RuntimeError('Network guard bypassed')
    monkeypatch.setattr(requests.adapters.HTTPAdapter, 'send', transport)
    try:
        requests.get('https://unmocked.example/cards', timeout=1)
    except AssertionError:
        if not SWALLOW:
            raise
'''.replace('SWALLOW', repr(swallow_error)), encoding='utf-8')
    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', str(tmp_path)],
                            cwd=tmp_path, text=True, capture_output=True, timeout=30)
    assert result.returncode == 1, result.stdout + result.stderr
    assert 'RuntimeError: Network guard bypassed' not in result.stdout
    assert 'Unmocked network request(s)' in result.stdout
