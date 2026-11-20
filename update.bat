@echo off
setlocal
cd /d "%~dp0"

echo === FlowChat updater ===
echo.

:: ---- Pull latest from origin/main ----
:: --ff-only refuses to create a merge commit if your local branch has
:: diverged from origin; you'd rather see the error than a surprise merge.
echo Pulling latest from origin/main...
git pull --ff-only origin main
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Pull failed. Your local branch has likely diverged from origin/main,
    echo or you have uncommitted changes to files the update touches.
    echo Nothing was changed. Run "git status" to see what's going on.
    pause
    exit /b 1
)

echo.
echo Done. Restart the server ^(start.bat^) to pick up the changes.
pause
