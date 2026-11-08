#!/usr/bin/env python3
"""Build once, then run each selected test in a disposable container."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["python", "node", "worker", "ui"])
    parser.add_argument("--match", default="", help="Select test names containing this text")
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--image", default="silhouette-integration:local")
    parser.add_argument("--results", default="/tmp/silhouette-integration-results.json")
    args = parser.parse_args()
    if not args.no_build:
        subprocess.run(["docker", "build", "-f", "tests/integration/Dockerfile", "-t", args.image, "."], cwd=ROOT, check=True)
    image = subprocess.check_output(["docker", "image", "inspect", "--format={{.Id}}", args.image], text=True).strip()
    base = ["docker", "run", "--rm", "--init", "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--shm-size=256m"]
    output = subprocess.check_output(base + [image, "collect"], cwd=ROOT, text=True)
    cases = json.loads(next(line[6:] for line in output.splitlines() if line.startswith("CASES=")))
    cases = [c for c in cases if (not args.suite or c["suite"] == args.suite) and args.match in c["name"]]
    if not cases:
        parser.error("No tests matched")
    results = []
    try:
        for index, case in enumerate(cases, 1):
            print(f'[{index}/{len(cases)}] {case["suite"]}: {case["name"]}', flush=True)
            name = "scm-test-" + uuid.uuid4().hex
            try:
                code = subprocess.run(base + ["--name", name, image, json.dumps(case)], cwd=ROOT, timeout=210).returncode
            except subprocess.TimeoutExpired:
                code = 124
            finally:
                # Remove the container before starting the next case, even on failure.
                subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            results.append(dict(case, returncode=code))
            Path(args.results).write_text(json.dumps(results, indent=2) + "\n")
    finally:
        print(f'{sum(r["returncode"] == 0 for r in results)}/{len(cases)} passed; results: {args.results}')
    return int(any(r["returncode"] for r in results))


if __name__ == "__main__":
    sys.exit(main())
