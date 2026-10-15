@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0" || exit /b 1
REM Build script for PDF generator executables
REM Ensure you run this from the project root (where requirements.txt is)

echo Checking Python version...
python --version

echo.
echo Note: If using Python 3.13+, some packages may need older versions.
echo Consider using Python 3.11 or 3.12 for best compatibility.
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
REM Install all packages except numpy first
python -m pip install click==8.1.8 natsort==8.4.0 Pillow==11.3.0 pydantic==2.11.1 Requests==2.32.3 pypdfium2==4.30.0 split-image==2.0.1 --no-warn-script-location
if errorlevel 1 exit /b 1

echo.
echo Installing numpy (using compatible version)...
REM Try to install numpy from pre-built wheel, fall back to older version if needed
python -m pip install numpy --only-binary :all: --no-warn-script-location || python -m pip install numpy==1.26.4 --no-warn-script-location
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
