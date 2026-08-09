@echo off
cd /d "%~dp0"
where pythonw.exe >nul 2>&1
if %errorlevel%==0 (
    start "Latent Art Wallpaper Server" /b pythonw.exe server.py
) else (
    start "Latent Art Wallpaper Server" /b python.exe server.py
)
