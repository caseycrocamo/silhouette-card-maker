"""Offline Studio bridge tests. Never import Windows automation on this host."""
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import studio_worker as worker
from enums import Orientation, Unit, Variant


@dataclass
class Registration:
    enabled: bool = True
    length: float = 0
    thickness: float = 0
    inset: float = 0


def request(tmp_path, **options):
    source = tmp_path / 'letter-poker.dxf'
    source.write_text('fixture')
    return {'operation': 'single', 'inputPath': str(source),
            'outputPath': str(tmp_path / '結果.studio3'), **options}


def backend(tmp_path):
    config = SimpleNamespace(paper_sizes={'letter': SimpleNamespace(width='11in', height='8.5in')})
    automation = Mock()
    automation.convert.side_effect = lambda **kwargs: Path(kwargs['output_studio3']).write_text('studio fixture')
    module = SimpleNamespace(load_layout_config=lambda: config, resolve_paper_size_alias=lambda config, name: name,
        Orientation=Orientation, Unit=Unit, Variant=Variant, RegistrationSettings=Registration,
        configure_runtime=Mock(), release_inputs=Mock(), load_calibration=Mock(return_value={'elements': {'test': {}}}),
        SilhouetteAutomation=Mock(return_value=automation),
        parse_dxf_filename=lambda name, config: ('letter', 'poker', Variant.BORDERLESS if 'borderless' in name else Variant.DEFAULT),
        get_paper_dimensions=lambda *args: ('11in', '8.5in'),
        get_orientation_for_dxf=lambda *args: Orientation.LANDSCAPE,
        get_max_length_for_dxf=lambda *args: 7.5,
        page_manager=SimpleNamespace(MAX_REG_THICKNESS_MM=1, MIN_REG_INSET_MM=10),
        adjust_paper_for_borderless=lambda w, h: ('11.2in', '8.7in'),
        determine_cutting_mat=lambda *args: '12x12', CuttingMat=SimpleNamespace(MAT_12X24='12x24'),
        size_convert=SimpleNamespace(size_to_in=lambda value: float(value[:-2])))
    return module, automation


def test_non_windows_does_not_import_windows_module(tmp_path):
    load = Mock(side_effect=AssertionError('Must not import Windows automation'))
    assert worker.capabilities('Darwin')['supported'] is False
    with pytest.raises(RuntimeError, match='requires Windows'):
        worker.run_job(request(tmp_path), lambda event: None, Mock(), Mock(), system='Darwin', load_module=load)
    load.assert_not_called()


@pytest.mark.parametrize('field,value', [('actionDelay', 0), ('regLength', float('nan')),
    ('regInset', -1), ('unit', 'cm'), ('orientation', 'optimize'), ('dryRun', 'yes')])
def test_invalid_options_fail_before_automation(tmp_path, field, value):
    with pytest.raises(ValueError):
        worker.validate_request(request(tmp_path, **{field: value}))


def test_single_dry_run_never_starts_studio_or_writes_output(tmp_path):
    module, automation = backend(tmp_path)
    events = []
    result = worker.run_job(request(tmp_path, dryRun=True, registration=True, regLength=12),
        events.append, Mock(), Mock(), system='Windows', load_module=lambda: module)
    assert result['dryRun']
    assert events[0]['event'] == 'preview'
    assert events[0]['outputPath'].endswith('結果.studio3')
    automation.start.assert_not_called()
    automation.convert.assert_not_called()
    assert not Path(result['items'][0]['outputPath']).exists()
    module.release_inputs.assert_not_called()


def test_single_conversion_preserves_options_and_reports_output(tmp_path):
    module, automation = backend(tmp_path)
    exe = tmp_path / 'Studio.exe'
    exe.write_text('fixture')
    events = []
    result = worker.run_job(request(tmp_path, studioPath=str(exe), registration=True, regLength=3,
        regThickness=0.5, regInset=10, unit='in', orientation='portrait', center=False),
        events.append, Mock(), Mock(), system='Windows', load_module=lambda: module)
    assert result['completed'] == 1
    kwargs = automation.convert.call_args.kwargs
    assert kwargs['unit'] == Unit.IN
    assert kwargs['orientation'] == Orientation.PORTRAIT
    assert kwargs['center'] is False
    assert kwargs['registration'] == Registration(True, 3, 0.5, 10)
    assert any(event['event'] == 'output' for event in events)
    module.release_inputs.assert_called_once()


def test_batch_missing_selection_matches_cli_directory_structure(tmp_path):
    module, _ = backend(tmp_path)
    (tmp_path / 'dxf').mkdir()
    (tmp_path / 'borderless' / 'dxf').mkdir(parents=True)
    (tmp_path / 'dxf' / 'letter-poker.dxf').write_text('fixture')
    (tmp_path / 'borderless' / 'dxf' / 'letter-poker-borderless.dxf').write_text('fixture')
    (tmp_path / 'letter-poker.studio3').write_text('already complete')
    req = worker.validate_request({'operation': 'batch', 'templateDir': str(tmp_path), 'missingOnly': True, 'unit': 'in'})
    jobs = worker.build_jobs(req, module)
    assert len(jobs) == 1
    assert jobs[0]['borderless'] is True
    assert jobs[0]['output_studio3'] == str(tmp_path / 'borderless' / 'letter-poker-borderless.studio3')
    assert jobs[0]['paper_width'] == '11.2in'
    assert jobs[0]['registration'].inset == 10 / 25.4


def test_stop_keeps_completed_file_and_releases_inputs(tmp_path):
    module, automation = backend(tmp_path)
    exe = tmp_path / 'Studio.exe'
    exe.write_text('fixture')
    stopped = False
    original = automation.convert.side_effect
    def convert(**kwargs):
        nonlocal stopped
        original(**kwargs)
        stopped = True
    automation.convert.side_effect = convert
    def check():
        if stopped:
            raise worker.Cancelled('stopped')
    with pytest.raises(worker.Cancelled):
        worker.run_job(request(tmp_path, studioPath=str(exe)), Mock(), Mock(), check,
                        system='Windows', load_module=lambda: module)
    assert (tmp_path / '結果.studio3').exists()
    module.release_inputs.assert_called_once()


def test_missing_calibration_rejects_before_start(tmp_path):
    module, automation = backend(tmp_path)
    exe = tmp_path / 'Studio.exe'
    exe.write_text('fixture')
    module.load_calibration.return_value = None
    with pytest.raises(ValueError, match='calibration is missing'):
        worker.run_job(request(tmp_path, studioPath=str(exe)), Mock(), Mock(), Mock(),
                        system='Windows', load_module=lambda: module)
    automation.start.assert_not_called()


def test_structured_calibration_records_after_pointer_delay_and_keeps_skipped(tmp_path):
    module, _ = backend(tmp_path)
    module.start_and_resize_studio = Mock(return_value=(None, {'x': 10, 'y': 20, 'width': 1920, 'height': 1080}))
    module.CALIBRATION_ELEMENTS = [{'id': 'first', 'name': 'First', 'description': 'Control one'},
                                   {'id': 'saved', 'name': 'Saved', 'description': 'Control two'}]
    module.load_calibration.return_value = {'elements': {'saved': {'relative': {'x': 1, 'y': 2}}}}
    module.automation_sleep = Mock()
    module.pyautogui = SimpleNamespace(position=Mock(return_value=SimpleNamespace(x=50, y=80)))
    module.save_calibration = Mock()
    prompt = Mock(side_effect=['4.5', 'record', 'skip'])
    events = []
    result = worker.run_job({'operation': 'calibrate', 'calibrationPath': str(tmp_path / 'coordinates.json')},
        events.append, prompt, Mock(), system='Windows', load_module=lambda: module)
    data, destination = module.save_calibration.call_args.args
    assert data['silhouette_studio_version'] == '4.5'
    assert data['elements']['first']['relative'] == {'x': 40, 'y': 60}
    assert data['elements']['saved']['relative'] == {'x': 1, 'y': 2}
    module.automation_sleep.assert_called_once_with(3)
    assert result['elements'] == 2
    assert prompt.call_args_list[1].kwargs['choices'] == ['record', 'skip', 'back']
    assert any(event['event'] == 'countdown' for event in events)


def test_cancelled_calibration_does_not_overwrite_saved_definitions(tmp_path):
    module, _ = backend(tmp_path)
    module.start_and_resize_studio = Mock(return_value=(None, {}))
    module.save_calibration = Mock()
    def prompt(*args, **kwargs):
        raise worker.Cancelled('stopped at prompt')
    with pytest.raises(worker.Cancelled):
        worker.run_job({'operation': 'calibrate', 'calibrationPath': str(tmp_path / 'coordinates.json')},
            Mock(), prompt, Mock(), system='Windows', load_module=lambda: module)
    module.save_calibration.assert_not_called()
    module.release_inputs.assert_called_once()


def test_real_non_windows_protocol_reports_errors_without_windows_import(tmp_path):
    import json
    import platform
    import subprocess
    import sys
    if platform.system() == 'Windows':
        pytest.skip('This case checks the unsupported-host route.')
    process = subprocess.Popen([sys.executable, str(Path(worker.__file__))],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding='utf-8')
    try:
        ready = json.loads(process.stdout.readline())
        assert ready['event'] == 'ready' and ready['supported'] is False
        process.stdin.write('[]\n')
        process.stdin.flush()
        assert json.loads(process.stdout.readline())['event'] == 'protocol-error'
        process.stdin.write(json.dumps({'command': 'start', 'request': request(tmp_path)}) + '\n')
        process.stdin.flush()
        result = json.loads(process.stdout.readline())
        assert result['event'] == 'result' and result['ok'] is False
        assert 'requires Windows' in result['error']
        process.stdin.close()
        assert process.wait(timeout=5) == 0
        assert not process.stderr.read()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_batch_reports_a_failed_file_and_continues_to_next(tmp_path):
    module, automation = backend(tmp_path)
    (tmp_path / 'dxf').mkdir()
    for name in ('a.dxf', 'b.dxf'):
        (tmp_path / 'dxf' / name).write_text('fixture')
    exe = tmp_path / 'Studio.exe'
    exe.write_text('fixture')
    def convert(**kwargs):
        if Path(kwargs['input_dxf']).name == 'a.dxf':
            raise RuntimeError('fixture save failed')
        Path(kwargs['output_studio3']).write_text('completed')
    automation.convert.side_effect = convert
    events = []
    result = worker.run_job({'operation': 'batch', 'templateDir': str(tmp_path), 'studioPath': str(exe)},
        events.append, Mock(), Mock(), system='Windows', load_module=lambda: module)
    assert result['completed'] == 1 and result['errors'] == 1
    assert result['items'][0]['error'] == 'fixture save failed'
    assert (tmp_path / 'b.studio3').exists()
    assert not (tmp_path / 'a.studio3').exists()
