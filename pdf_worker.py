"""Long-lived PDF worker process.

Started once at app launch, this process pays the one-time import/startup cost
(PyInstaller onefile self-extraction + macOS Gatekeeper scan) a single time and
then services both `create_pdf` and `offset_pdf` requests over stdin/stdout for
the rest of the session.

Protocol: one JSON request object per input line, one JSON response object per
output line. Requests are handled strictly one at a time (single-threaded) — the
stdout capture below swaps process-global `sys.stdout`, so concurrency is not
safe here. Do not add threading without redesigning stdout capture.

Response shape: {"ok": bool, "log": str, "error": str}.
"""

import contextlib
import io
import json
import sys

# Importing these is where the one-time startup tax is paid. Both are unmodified
# click.Command objects living at the repo root.
from create_pdf import cli as create_pdf_cmd
from offset_pdf import offset_pdf as offset_pdf_cmd


def handle_create_pdf(req):
    """Invoke create_pdf via Click's own parser so option handling never drifts."""
    args = req.get("args", [])
    buf = io.StringIO()
    error = ""
    ok = True
    try:
        with contextlib.redirect_stdout(buf):
            ctx = create_pdf_cmd.make_context("create_pdf", list(args))
            create_pdf_cmd.invoke(ctx)
    except Exception as e:  # includes Click's UsageError for bad args
        ok = False
        error = str(e)
    return {"ok": ok, "log": buf.getvalue(), "error": error}


def handle_offset_pdf(req):
    """Call the raw callback directly, bypassing Click's argv parsing/sys.exit.

    Because `.callback` skips Click's default-filling, every parameter must be
    supplied explicitly. `offset_pdf.py` swallows FileNotFoundError internally
    (prints "Cannot offset nonexistent PDF: ..." instead of raising), so a
    missing file is not an error case here — it only shows up in the log.
    """
    buf = io.StringIO()
    error = ""
    ok = True
    try:
        with contextlib.redirect_stdout(buf):
            offset_pdf_cmd.callback(
                pdf_path=req["pdf_path"],
                output_pdf_path=req.get("output_pdf_path", None),
                x_offset=req.get("x_offset", None),
                y_offset=req.get("y_offset", None),
                save=req.get("save", False),
                ppi=req.get("ppi", 300),
            )
    except Exception as e:
        ok = False
        error = str(e)
    return {"ok": ok, "log": buf.getvalue(), "error": error}


def dispatch(req):
    command = req.get("command")
    if command == "create_pdf":
        return handle_create_pdf(req)
    if command == "offset_pdf":
        return handle_offset_pdf(req)
    return {"ok": False, "log": "", "error": f"unknown command: {command}"}


def main():
    # Signal readiness only after the expensive imports above have completed.
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        # A broad guard so one malformed request can never kill the loop.
        try:
            req = json.loads(line)
            resp = dispatch(req)
        except Exception as e:
            resp = {"ok": False, "log": "", "error": str(e)}

        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    main()
