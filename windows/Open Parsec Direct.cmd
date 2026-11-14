@echo off
title Parsec Direct Helper
py -3.11 -c "import sys; sys.path.insert(0, r'%~dp0.'); import frida; assert frida.__version__ == '17.26.2'" >nul 2>&1
if errorlevel 1 (
  echo Installing the required Frida package from PyPI...
  py -3.11 -m pip install --disable-pip-version-check --target "%~dp0" -r "%~dp0requirements.txt"
  if errorlevel 1 (
    echo Installation failed. Install 64-bit Python 3.11 and pip, then try again.
    pause
    exit /b 1
  )
)
py -3.11 "%~dp0parsec_direct.py"
if errorlevel 1 pause
