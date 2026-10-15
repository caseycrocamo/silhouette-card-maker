# Development Environment Setup

If you're starting with a fresh install of your operating system, follow these steps to set up your development environment:

## 1. Install Python

- Download Python from the official website: https://www.python.org/downloads/
- Run the installer and **check the box to add Python to your PATH**.
- Verify installation:
   ```powershell
   python --version
   ```

## 2. Install Node.js

- Download Node.js (LTS version recommended) from: https://nodejs.org/
- Run the installer and follow the prompts.
- Verify installation:
   ```powershell
   node --version
   npm --version
   ```

Once Python and Node.js are installed, continue with the project setup steps below.
# Silhouette Card Maker GUI

- Node.js (v18 or newer recommended)
- Python (v3.10+ recommended)
- All Python dependencies listed in the project root `requirements.txt`
## 1. Install Python

- **Windows:** Download Python from the official website: https://www.python.org/downloads/
   - Run the installer and **check the box to add Python to your PATH**.
- **Linux/Mac:** Install via your package manager or download from the website.
   - Ubuntu/Debian:
      ```bash
      sudo apt update && sudo apt install python3 python3-pip
      ```
   - Mac (Homebrew):
      ```bash
      brew install python3
      ```
- Verify installation:
   ```powershell
   python --version
   ```
   ```bash
   python3 --version
   ```

## Setup

   npm install
   ```

2. **Install Python dependencies**
## 2. Install Node.js

- **Windows:** Download Node.js (LTS version recommended) from: https://nodejs.org/
   - Run the installer and follow the prompts.
- **Linux/Mac:** Install via your package manager or download from the website.
   - Ubuntu/Debian:
      ```bash
      sudo apt update && sudo apt install nodejs npm
      ```
   - Mac (Homebrew):
      ```bash
      brew install node
      ```
- Verify installation:
   ```powershell
   node --version
   npm --version
   ```
   ```bash
   node --version
   npm --version
   ```
   ```powershell
   cd ..
   python -m pip install -r requirements.txt
   ```

3. **Build the Python executables**
   Required for PDF generation in the GUI, including packaged Windows builds.

   **Windows:**
   ```powershell
   .\build_entrypoints.bat
   ```

   **macOS/Linux:**
   ```bash
   ./build_entrypoints.sh
   ```

   This creates the top-level Python entrypoint executables in the project root,
   including `pdf_worker.exe` on Windows (`pdf_worker` on macOS/Linux). The GUI
   uses this persistent worker for both PDF creation and offsets.

   From the project root, stage the executables for Electron:
   ```powershell
   npm run copy:entrypoints
   ```

   To build the executables, stage them, and package the app for your current OS:
   ```powershell
   npm run build-all
   ```
   Releases are written to `GUI/dist`: installer/ZIP on Windows, DMG/ZIP on
   macOS, and AppImage/tar.gz on Linux. Build on the target OS and architecture;
   PyInstaller executables are native binaries and cannot be reused across OSes.
   macOS and Linux builds use the host architecture. Packaging checks that all
   required executables exist in `GUI/bin` before creating a release.

   `npm test` checks entrypoint discovery and paths for all three platforms.
   After building the worker, `python -m unittest discover -s tests` verifies
   PDF creation, offsets, Unicode paths, and worker reuse. The PDF worker
   compatibility workflow runs these checks on Windows, macOS, and Linux.

   The build script will:
   1. Install/upgrade pip
   2. Install required Python packages
   3. Install PyInstaller
   4. Build a standalone executable
   5. Clean up temporary build files

## Running the GUI

1. **Start the Electron app**
   ```powershell
   cd GUI
   npm run start
   ```

The GUI will open in a new window. You can generate PDFs, view images, and use all available features.

## Development Notes
- The Electron app communicates with Python via IPC and can run either the script or the compiled executable.
- For advanced features, see the main project README and the scripts in the root directory.

## Troubleshooting
- If you see errors about missing Python modules, ensure you installed all dependencies from `requirements.txt`.
- If PDF creation or offsets report a missing `pdf_worker.exe`, rebuild and stage
  the Python executables as shown above, then rebuild the installer. Older
  Windows builds could skip this worker because their entrypoint discovery
  only recognized single-quoted `__main__` guards.
- For Windows, use PowerShell or Command Prompt. For Mac/Linux, adapt commands as needed.

## Application updates and releases

The supported release targets are Windows x64 NSIS installer and ZIP, macOS x64
and arm64 DMG and ZIP, and Linux x64 AppImage and tar.gz. Builds run on the
matching operating system and architecture because the bundled Python tools are
native executables. macOS packages are currently unsigned; updates on macOS are
installed manually from the release page. Windows ZIP and Linux tar.gz builds
also require manual installation. In-app installation is intended for Windows
NSIS and Linux AppImage packages.

Earlier versions do not contain the update service. Users upgrading from one of
those versions must download and install the first updater-enabled release
manually. Later releases can be discovered by the app. Automatic checks are
enabled by default. Settings shows the installed version, last successful check,
automatic-check toggle, manual **Check for updates** button, and current status.
The first automatic check runs 12 seconds after launch, followed by checks every
24 hours. **Later** hides a version's notice for 24 hours; the update remains
available in Settings. Downloads and **Restart and install** always require the
user to choose them.
The release feed is explicitly configured for
[`caseycrocamo/silhouette-card-maker`](https://github.com/caseycrocamo/silhouette-card-maker).
Application identity and Electron user-data location must remain stable so
images, decklists, calibration, offsets, and PDFs stay in the user's data area.

### Building and checking a release

Set `GUI/package.json`'s version and push the matching `v<version>` tag, such as
`v1.2.0`. The release workflow rejects a tag that does not match that package
version. It builds and tests every supported target, verifies the generated
metadata, hashes, blockmaps, and target artifacts, uploads the full set to a
draft GitHub release, and publishes only after verification succeeds. CI uses
the repository's `GITHUB_TOKEN`; public clients need no embedded token. A manual
workflow dispatch runs the builds and checks only and does not create or publish
a release.

For a local build, install the GUI dependencies with `npm ci`, build the CSS,
build and stage native Python entrypoints from the repository root, then run an
appropriate command from `GUI` on the matching platform, such as
`npx electron-builder --win --x64 --publish never`. Use `--mac` or `--linux` for
those targets, and `--arm64` for Apple silicon. Use the release verifier against
the resulting `GUI/dist` folder, providing the package version and platform
list. Never reuse Python binaries built for a different OS or architecture.

Release artifacts are unsigned today, so checksum validation establishes file
integrity but does not verify publisher identity. Apple Developer ID signing
and notarization are not configured. Before announcing the first updater-enabled
release, validate a real version N-to-N+1 installation on Windows NSIS and
Linux AppImage using an isolated test feed. The CI artifact checks are not a
substitute for that packaged upgrade test. Also confirm ordinary quit, active
PDF work, checksum failure, download failure, and data preservation on those
targets; test the manual replacement flow on macOS and archive distributions.

On Windows, after building the application, run the Electron UI/IPC smoke and
the real updater download smoke from the repository root with:

```powershell
node GUI/node_modules/electron/cli.js tests/update-ui-smoke.cjs
node GUI/node_modules/electron/cli.js tests/update-download-smoke.cjs
```

The download smoke reads the installer named by `GUI/dist/latest.yml`, uses an
isolated loopback feed and cache, checks the real updater's SHA-512 validation,
and never launches the installer. The manual-flow and full N-to-N+1 install
checks remain separate release qualification steps.

---

For more help, see the main project README or contact the project maintainer.
