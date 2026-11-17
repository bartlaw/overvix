@echo off
setlocal

:: Ensure working directory is the folder where this script resides
cd /d "%~dp0"

set "APP_URL=http://localhost:8082/"
set "HEALTH_URL=http://127.0.0.1:8082/api/status"
set "APP_ID=obkpamibnmnljoahelbcbkfmoimcaeai"

:: Locate Edge proxy executable (supports both 32-bit and 64-bit Program Files)
set "EDGE_PROXY=C:\Program Files (x86)\Microsoft\Edge\Application\msedge_proxy.exe"
if not exist "%EDGE_PROXY%" (
    if exist "C:\Program Files\Microsoft\Edge\Application\msedge_proxy.exe" (
        set "EDGE_PROXY=C:\Program Files\Microsoft\Edge\Application\msedge_proxy.exe"
    )
)

:: 1. Check if the Edge web app / PWA is already running
set "EDGE_APP_RUNNING=0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$found = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and ($_.CommandLine -like '*obkpamibnmnljoahelbcbkfmoimcaeai*' -or $_.CommandLine -like '*localhost:8082*') }; if (-not $found) { $found = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*Overvix*' } }; if ($found) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
    set "EDGE_APP_RUNNING=1"
)

if "%EDGE_APP_RUNNING%"=="1" (
    echo [INFO] Edge web app is already running. Skipping browser launch.
) else (
    echo [INFO] Edge web app is not running. Launching...
    if exist "%EDGE_PROXY%" (
        start "" "%EDGE_PROXY%" --profile-directory=Default --app-id=%APP_ID% --app-url=%APP_URL% --app-launch-source=4
    ) else (
        start "" "%APP_URL%"
    )
)

:: 2. Check if backend server is already running on port 8082
set "BACKEND_RUNNING=0"
curl.exe -s -m 1 -f "%HEALTH_URL%" >nul 2>&1
if not errorlevel 1 (
    set "BACKEND_RUNNING=1"
) else (
    netstat -ano 2>nul | findstr ":8082" | findstr "LISTENING" >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_RUNNING=1"
    )
)

if "%BACKEND_RUNNING%"=="1" (
    echo [INFO] Overvix backend is already running on port 8082.
    timeout /t 2 /nobreak >nul 2>&1
    exit /b 0
)

echo [INFO] Starting Overvix backend...
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" dashboard.py
) else (
    where uv.exe >nul 2>&1
    if not errorlevel 1 (
        uv run python dashboard.py
    ) else (
        python dashboard.py
    )
)
