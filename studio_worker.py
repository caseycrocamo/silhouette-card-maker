#!/usr/bin/env python3
"""One-job, line-delimited JSON bridge for Windows Studio automation.

The automation module is imported only after a Windows capability check. Standard
output carries events; automation logs are separate structured log events.
"""
from __future__ import annotations

import contextlib
import json
import math
from pathlib import Path
import platform
import queue
import sys
import threading
import uuid

DEFAULT_STUDIO_PATH = r'C:\Program Files\Silhouette America\Silhouette Studio\Silhouette Studio.exe'


class Cancelled(Exception):
    pass


def capabilities(system=None):
    supported = (system or platform.system()) == 'Windows'
    return {'supported': supported, 'windowWidth': 1920, 'windowHeight': 1080,
            'defaultStudioPath': DEFAULT_STUDIO_PATH,
            'message': '' if supported else 'Studio automation requires Windows. Open the DXF in Silhouette Studio and save it as a .studio3 file.'}


def _number(value, name, default=0, minimum=0):
    value = default if value is None else value
    if isinstance(value, bool):
        raise ValueError(f'{name} must be a finite number.')
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{name} must be a finite number.') from None
    if not math.isfinite(value) or value < minimum:
        raise ValueError(f'{name} must be at least {minimum}.')
    return value


def validate_request(request):
    if not isinstance(request, dict):
        raise ValueError('A Studio request must be an object.')
    operation = request.get('operation', 'single')
    if operation not in ('single', 'batch', 'calibrate'):
        raise ValueError('Unknown Studio operation.')
    result = dict(request, operation=operation)
    for field in ('dryRun', 'missingOnly', 'center', 'registration'):
        if field in request and not isinstance(request[field], bool):
            raise ValueError(f'{field} must be true or false.')
    result['unit'] = request.get('unit', 'mm')
    if result['unit'] not in ('mm', 'in'):
        raise ValueError('Unit must be mm or in.')
    result['orientation'] = request.get('orientation', 'landscape')
    if result['orientation'] not in ('portrait', 'landscape'):
        raise ValueError('Orientation must be portrait or landscape.')
    result['actionDelay'] = _number(request.get('actionDelay'), 'Action delay', 1, 0.1)
    for field in ('regLength', 'regThickness', 'regInset'):
        result[field] = _number(request.get(field), field)
    for field in ('inputPath', 'outputPath', 'templateDir', 'calibrationPath', 'studioPath', 'paperSize'):
        if field in request and (not isinstance(request[field], str) or not request[field].strip() or '\x00' in request[field]):
            raise ValueError(f'{field} must be a nonempty path or name.')
    if operation == 'single':
        source = Path(request.get('inputPath', ''))
        if not source.is_file() or source.suffix.lower() != '.dxf':
            raise ValueError('Choose an existing DXF file.')
        destination = Path(request.get('outputPath', ''))
        if destination.suffix.lower() != '.studio3':
            raise ValueError('Choose an output file with the .studio3 extension.')
    if operation == 'batch' and not Path(request.get('templateDir', '')).is_dir():
        raise ValueError('Choose an existing templates folder.')
    if operation == 'calibrate' and not request.get('calibrationPath'):
        raise ValueError('Choose an automation calibration JSON destination.')
    return result


def build_jobs(request, module):
    """Match the CLI's layout, borderless and missing-output batch rules."""
    config = module.load_layout_config()
    unit = module.Unit(request['unit'])
    if request['operation'] == 'single':
        paper = module.resolve_paper_size_alias(config, request.get('paperSize', 'letter'))
        if paper not in config.paper_sizes:
            raise ValueError('Unknown paper size.')
        definition = config.paper_sizes[paper]
        registration = None
        if request.get('registration', False):
            registration = module.RegistrationSettings(enabled=True, length=request['regLength'],
                thickness=request['regThickness'], inset=request['regInset'])
        return [{'input_dxf': request['inputPath'], 'output_studio3': request['outputPath'],
                 'paper_width': definition.width, 'paper_height': definition.height, 'unit': unit,
                 'orientation': module.Orientation(request['orientation']),
                 'center': request.get('center', True), 'registration': registration}]
    root = Path(request['templateDir'])
    files = sorted(list((root / 'dxf').glob('*.dxf')) + list((root / 'borderless' / 'dxf').glob('*.dxf')))
    jobs = []
    for source in files:
        paper, card, variant = module.parse_dxf_filename(source.name, config) or (None, None, None)
        borderless = variant == module.Variant.BORDERLESS
        output = (root / 'borderless' if borderless else root) / source.with_suffix('.studio3').name
        if request.get('missingOnly') and output.exists():
            continue
        width, height = module.get_paper_dimensions(paper, config)
        skip = None
        if borderless:
            virtual_width, virtual_height = module.adjust_paper_for_borderless(width, height)
            mat = module.determine_cutting_mat(module.size_convert.size_to_in(width), module.size_convert.size_to_in(height))
            if mat == module.CuttingMat.MAT_12X24:
                vw, vh = module.size_convert.size_to_in(virtual_width), module.size_convert.size_to_in(virtual_height)
                if min(vw, vh) > 12 or max(vw, vh) > 24:
                    skip = 'Virtual paper exceeds the 12×24 mat limit.'
            width, height = virtual_width, virtual_height
        length = module.get_max_length_for_dxf(paper, card, variant, config, unit)
        divisor = 1 if unit == module.Unit.MM else 25.4
        registration = module.RegistrationSettings(enabled=True, length=length if length is not None else 0,
            thickness=module.page_manager.MAX_REG_THICKNESS_MM / divisor,
            inset=module.page_manager.MIN_REG_INSET_MM / divisor)
        jobs.append({'input_dxf': str(source), 'output_studio3': str(output), 'paper_width': width,
                     'paper_height': height, 'unit': unit,
                     'orientation': module.get_orientation_for_dxf(paper, card, variant, config),
                     'center': True, 'registration': registration, 'borderless': borderless,
                     **({'skip': skip} if skip else {})})
    return jobs


def _summary(job):
    return {'inputPath': job['input_dxf'], 'outputPath': job['output_studio3'],
            'paperWidth': job['paper_width'], 'paperHeight': job['paper_height'],
            'orientation': job['orientation'].value, 'unit': job['unit'].value,
            'skipped': bool(job.get('skip')), 'reason': job.get('skip', '')}


def calibrate(request, module, emit, prompt, check_stop):
    destination = Path(request['calibrationPath'])
    check_stop()
    _, rect = module.start_and_resize_studio(request.get('studioPath', DEFAULT_STUDIO_PATH))
    existing = module.load_calibration(destination) or {}
    version = prompt('version', 'Enter your Silhouette Studio version.', default=existing.get('silhouette_studio_version', 'unknown'))
    result = {'silhouette_studio_version': version or 'unknown', 'window': rect,
              'elements': dict(existing.get('elements', {})), 'notes': 'All coordinates are relative to the window top-left corner'}
    index = 0
    while index < len(module.CALIBRATION_ELEMENTS):
        check_stop()
        element = module.CALIBRATION_ELEMENTS[index]
        response = prompt('element', f"{element['name']}: {element['description']}",
                          elementId=element['id'], index=index + 1, total=len(module.CALIBRATION_ELEMENTS),
                          recordDelay=3, choices=['record', 'skip', 'back'])
        if response == 'back':
            index = max(0, index - 1)
            continue
        if response not in ('skip', 'record'):
            raise ValueError('Choose Record, Skip, or Back.')
        if response == 'record':
            emit({'event': 'countdown', 'seconds': 3, 'message': 'Move the pointer to the Studio control. Keep it there for three seconds.'})
            module.automation_sleep(3)
            check_stop()
            pos = module.pyautogui.position()
            result['elements'][element['id']] = {'name': element['name'],
                'relative': {'x': pos.x - rect['x'], 'y': pos.y - rect['y']}}
        index += 1
        emit({'event': 'progress', 'completed': index, 'total': len(module.CALIBRATION_ELEMENTS)})
    check_stop()
    module.save_calibration(result, destination)
    return {'calibrationPath': str(destination), 'elements': len(result['elements'])}


def load_windows_automation():
    # Static import inside the Windows-only route also lets PyInstaller discover
    # the automation module and its Windows dependencies.
    import dxf_to_studio3
    return dxf_to_studio3


def run_job(request, emit, prompt, check_stop, *, system=None, load_module=None):
    request = validate_request(request)
    if not capabilities(system)['supported']:
        raise RuntimeError(capabilities(system)['message'])
    check_stop()
    module = (load_module or load_windows_automation)()
    check_stop()
    module.configure_runtime(check_stop)
    touched_automation = False
    try:
        if request['operation'] == 'calibrate':
            touched_automation = True
            return calibrate(request, module, emit, prompt, check_stop)
        jobs = build_jobs(request, module)
        if request.get('dryRun'):
            items = [_summary(job) for job in jobs]
            for item in items:
                emit({'event': 'preview', **item})
            return {'dryRun': True, 'items': items, 'completed': 0}
        if not jobs:
            return {'items': [], 'completed': 0}
        studio_path = request.get('studioPath', DEFAULT_STUDIO_PATH)
        if not Path(studio_path).is_file():
            raise ValueError('Silhouette Studio executable is unavailable.')
        calibration_path = Path(request['calibrationPath']) if request.get('calibrationPath') else None
        if not module.load_calibration(calibration_path):
            raise ValueError('Automation calibration is missing. Run Studio automation calibration first.')
        automation = module.SilhouetteAutomation(studio_path, calibration_path, request['actionDelay'])
        check_stop()
        touched_automation = True
        automation.start()
        completed, errors, items = 0, 0, []
        for job in jobs:
            check_stop()
            emit({'event': 'progress', 'completed': completed, 'total': len(jobs), 'currentFile': job['input_dxf']})
            item = _summary(job)
            if not job.get('skip'):
                Path(job['output_studio3']).parent.mkdir(parents=True, exist_ok=True)
                try:
                    automation.convert(**job)
                    if not Path(job['output_studio3']).is_file():
                        raise RuntimeError('Studio did not create the requested output file.')
                    completed += 1
                except Cancelled:
                    raise
                except Exception as exc:
                    fail_safe = getattr(getattr(module, 'pyautogui', None), 'FailSafeException', None)
                    if fail_safe and isinstance(exc, fail_safe):
                        raise
                    if request['operation'] == 'single':
                        raise
                    item['error'] = str(exc)
                    errors += 1
            items.append(item)
            emit({'event': 'output', **item})
        emit({'event': 'progress', 'completed': completed, 'total': len(jobs)})
        check_stop()
        return {'items': items, 'completed': completed, 'errors': errors}
    finally:
        # Do not close Studio on stop: its current document may be incomplete.
        try:
            if touched_automation:
                module.release_inputs()
        finally:
            module.configure_runtime()


class _LogEvents:
    def __init__(self, emit):
        self.emit, self.buffer = emit, ''

    def write(self, text):
        self.buffer += text
        while '\n' in self.buffer:
            line, self.buffer = self.buffer.split('\n', 1)
            if line.strip():
                self.emit({'event': 'log', 'message': line})
        return len(text)

    def flush(self):
        if self.buffer.strip():
            self.emit({'event': 'log', 'message': self.buffer})
        self.buffer = ''


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stdin.reconfigure(encoding='utf-8')
    output, lock = sys.stdout, threading.Lock()
    progress = {'completed': 0, 'currentFile': None, 'items': []}
    stopped, requests, replies = threading.Event(), queue.Queue(), queue.Queue()
    def emit(event):
        with lock:
            if event.get('event') == 'progress':
                progress['completed'] = event.get('completed', progress['completed'])
                progress['currentFile'] = event.get('currentFile', progress['currentFile'])
            elif event.get('event') == 'output':
                progress['items'].append(event)
                progress['completed'] = sum(not item.get('skipped') and not item.get('error') for item in progress['items'])
            output.write(json.dumps(event, ensure_ascii=False) + '\n')
            output.flush()
    def read():
        try:
            for line in sys.stdin:
                try:
                    data = json.loads(line)
                    if not isinstance(data, dict):
                        raise ValueError('Expected an object.')
                    if data.get('command') == 'stop':
                        stopped.set()
                    elif data.get('command') == 'reply':
                        replies.put(data)
                    elif data.get('command') == 'start':
                        requests.put(data.get('request'))
                    else:
                        emit({'event': 'protocol-error', 'error': 'Unknown worker command.'})
                except (ValueError, TypeError) as exc:
                    emit({'event': 'protocol-error', 'error': str(exc)})
        finally:
            stopped.set()
            requests.put(None)
    def check_stop():
        if stopped.is_set():
            raise Cancelled('Studio job stopped. Completed files are kept; the current Studio document may be incomplete.')
    def prompt(kind, message, **extra):
        check_stop()
        prompt_id = uuid.uuid4().hex
        emit({'event': 'prompt', 'promptId': prompt_id, 'kind': kind, 'message': message, **extra})
        while True:
            check_stop()
            try:
                reply = replies.get(timeout=0.1)
            except queue.Empty:
                continue
            if reply.get('promptId') != prompt_id:
                continue
            value = reply.get('value')
            if not isinstance(value, str):
                raise ValueError('Prompt reply must be text.')
            return value
    emit({'event': 'ready', **capabilities()})
    threading.Thread(target=read, daemon=True).start()
    request = requests.get()
    if request is None:
        return
    logs = _LogEvents(emit)
    try:
        with contextlib.redirect_stdout(logs), contextlib.redirect_stderr(logs):
            result = run_job(request, emit, prompt, check_stop)
        logs.flush()
        emit({'event': 'result', 'ok': True, 'result': result})
    except Cancelled as exc:
        logs.flush()
        emit({'event': 'result', 'ok': True, 'result': {'canceled': True, 'message': str(exc), **progress}})
    except Exception as exc:
        logs.flush()
        emit({'event': 'result', 'ok': False, 'error': str(exc)})


if __name__ == '__main__':
    main()
