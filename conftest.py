"""Tests are offline. Provider integration tests use local HTTP fixtures."""
import socket

import cloudscraper
import pytest
import requests


@pytest.fixture(autouse=True)
def offline_providers(request, monkeypatch):
    from provider_mocks import ProviderMocks

    blocked = []
    def forbid(*args, **kwargs):
        blocked.append(next((arg.url for arg in args if hasattr(arg, 'url')), repr(args)))
        raise AssertionError('Network access is disabled in tests. Mock the provider response.')

    monkeypatch.setattr(socket, 'getaddrinfo', forbid)
    monkeypatch.setattr(socket.socket, 'connect', forbid)
    monkeypatch.setattr(socket.socket, 'connect_ex', forbid)
    monkeypatch.setattr(requests.sessions.Session, 'send', forbid)
    if request.node.get_closest_marker('integration'):
        provider = ProviderMocks()
        def respond(_session, method, url, **kwargs):
            try:
                return provider.request(method, url, **kwargs)
            except AssertionError as error:
                blocked.append(str(error))
                raise
        monkeypatch.setattr(requests.sessions.Session, 'request', respond)
        monkeypatch.setattr(cloudscraper.CloudScraper, 'request', respond)
    yield
    assert not blocked, 'Unmocked network request(s): ' + '; '.join(blocked)
