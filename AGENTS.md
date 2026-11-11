# Agent Instructions

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Shared UI Elements

Always use shared UI elements when possible. Check `GUI/shared/` and `GUI/styles/tailwind.css` before adding a control. Extend a shared component when needed instead of copying its styles into a page.

For buttons, use the shared `paper-button` component. Static HTML uses its shared classes. JavaScript uses `createButton` from `GUI/shared/button.js`. Use the shared compact or icon size when needed. Keep colors, borders, focus, hover, and disabled states in the shared component; do not override them in page CSS.
