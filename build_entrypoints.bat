@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0" || exit /b 1
REM Build script for PDF generator executables
REM Ensure you run this from the project root (where requirements.txt is)

echo Checking Python version...
python --version

echo.
echo Use Python 3.12 or later.
echo Dependencies are pinned in requirements.txt.
echo.

echo Creating virtual environment...
if exist venv (
    echo Virtual environment already exists, deleting and recreating...
    rmdir /s /q venv
)
py -3.12 -m venv venv
if errorlevel 1 exit /b 1
echo Virtual environment created.

echo.
echo Activating virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 exit /b 1

echo.
echo Upgrading pip, setuptools, and wheel...
python -m pip install --upgrade pip setuptools wheel --no-warn-script-location
if errorlevel 1 exit /b 1

echo.
echo Installing dependencies from requirements.txt...
python -m pip install -r requirements.txt --no-warn-script-location
if errorlevel 1 exit /b 1

echo.
echo Installing PyInstaller...
python -m pip install pyinstaller --no-warn-script-location
if errorlevel 1 exit /b 1

echo.
echo Discovering build targets...
set TARGET_SCRIPTS=

REM Use the same quote/whitespace-tolerant discovery as the copy/check steps.
REM In particular, pdf_worker.py uses double quotes around __main__.
for /f "delims=" %%F in ('node check_and_build_entrypoints.js --list-targets') do (
    set TARGET_SCRIPTS=!TARGET_SCRIPTS! %%F
)

if not defined TARGET_SCRIPTS (
    echo No top-level Python entrypoint scripts found to build.
    call venv\Scripts\deactivate.bat
    exit /b 1
)

for %%S in (!TARGET_SCRIPTS!) do (
    echo.
    echo Building %%~nS executable with PyInstaller...
    python -m PyInstaller --noconfirm --onefile --add-data "assets;assets" %%S --distpath .
    if errorlevel 1 exit /b 1
)

echo.
echo Deactivating virtual environment...
call venv\Scripts\deactivate.bat

echo.
echo Cleaning up build artifacts...
rmdir /s /q build
rmdir /s /q __pycache__
for %%S in (!TARGET_SCRIPTS!) do (
    if exist %%~nS.spec del %%~nS.spec
)

echo.
echo Build complete. PDF executables are now in the project root.
