#!/bin/bash
# Build script for PDF generator executables
# Ensure you run this from the project root (where requirements.txt is)

set -e
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

echo "Checking Python version..."
python3 --version

echo ""
echo "Use Python 3.12 or later."
echo "Dependencies are pinned in requirements.txt."
echo ""

echo "Creating virtual environment..."
if [ -d "venv" ]; then
    echo "Virtual environment already exists, deleting and recreating..."
    rm -rf venv
fi
python3 -m venv venv
echo "Virtual environment created."

echo ""
echo "Activating virtual environment..."
source venv/bin/activate

echo ""
echo "Upgrading pip, setuptools, and wheel..."
python -m pip install --upgrade pip setuptools wheel --no-warn-script-location

echo ""
echo "Installing dependencies from requirements.txt..."
python -m pip install -r requirements.txt --no-warn-script-location

echo ""
echo "Installing PyInstaller..."
python -m pip install pyinstaller --no-warn-script-location

echo ""
echo "Exporting GUI settings and layout previews..."
python scripts/export_pdf_catalog.py

echo "Discovering build targets..."
TARGET_SCRIPTS=()
TARGET_LIST=$(node check_and_build_entrypoints.js --list-targets)
while IFS= read -r script; do
    if [ -n "$script" ]; then
        TARGET_SCRIPTS+=("$script")
    fi
done <<< "$TARGET_LIST"

if [ ${#TARGET_SCRIPTS[@]} -eq 0 ]; then
    echo "No top-level Python entrypoint scripts found to build."
    deactivate
    exit 1
fi

for script in "${TARGET_SCRIPTS[@]}"; do
    echo ""
    echo "Building ${script%.py} executable with PyInstaller..."
    python -m PyInstaller --noconfirm --onefile --add-data "assets:assets" "$script" --distpath .
done

echo ""
echo "Deactivating virtual environment..."
deactivate

echo ""
echo "Cleaning up build artifacts..."
rm -rf build
rm -rf __pycache__
for script in "${TARGET_SCRIPTS[@]}"; do
    rm -f "${script%.py}.spec"
done

echo ""
echo "Build complete. PDF executables are now in the project root."
