"""One container runs one test. Its writable layer is discarded on exit."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def collect():
    import pytest

    class Collector:
        def pytest_collection_finish(self, session):
            self.items = [dict(suite="python", name=i.nodeid) for i in session.items]
    collector = Collector()
    status = pytest.main(["--collect-only", "-q", "-m", "not slow", "test", "tests", "--ignore=tests/test_pdf_worker.py"], plugins=[collector])
    if status != 0:
        raise RuntimeError(f"pytest collection failed: {status}")
    cases = collector.items
    cases += json.loads(subprocess.check_output(["node", "tests/integration/collect-node.cjs"], text=True))
    cases += [dict(suite="worker", name="frozen-worker")]
    cases += [dict(suite="ui", name=n) for n in json.loads(subprocess.check_output(["node", "tests/integration/ui.cjs", "--list"], text=True))]
    cases += [dict(suite="ui", name=name, script=f"tests/{script}-smoke.cjs") for name, script in [
        ("decklist", "card-list"), ("decklist-printing", "printing-selector"),
        ("custom-layout-calibration", "gui-parity"), ("game-plugins", "game-plugins"),
        ("template-tools", "template-tools"), ("printer-calibration", "printer-calibration"),
        ("pdf-settings", "pdf-settings"), ("updates", "update-ui"),
        ("mtg-imports", "mtg-imports"), ("translation-parity", "text-translation"),
        ("studio-tools", "studio-tools"),
    ]]
    print("CASES=" + json.dumps(cases))


def run(case):
    Path(os.environ["HOME"]).mkdir(parents=True, exist_ok=True)
    marker = Path("/app/.integration-dirty")
    assert not marker.exists(), "Test state leaked from a previous case"
    marker.write_text(case["name"])
    suite = case["suite"]
    if suite == "python":
        cmd = ["python", "-m", "pytest", "-q", case["name"]]
    elif suite == "node":
        cmd = ["node", "--test", "--test-name-pattern=^" + re.escape(case["name"]) + "$", case["file"]]
    elif suite == "worker":
        cmd = ["python", "-m", "unittest", "-v", "tests.test_pdf_worker"]
    elif suite == "ui":
        cmd = ["xvfb-run", "-a", "GUI/node_modules/.bin/electron", "--no-sandbox", case.get("script", "tests/integration/ui.cjs")]
        if "script" not in case:
            cmd += [case["name"]]
    else:
        raise ValueError(suite)
    return subprocess.run(cmd, timeout=180).returncode


if __name__ == "__main__":
    if sys.argv[1] == "collect":
        collect()
    else:
        sys.exit(run(json.loads(sys.argv[1])))
