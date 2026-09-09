@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 네이버 블로그 자동화 - 실행 중 (닫지 마세요)
echo.
echo ================================================
echo   네이버 블로그 자동화
echo ================================================
echo.
echo [!] 이 창을 닫으면 앱이 꺼집니다. 켜둔 채로 두세요.
echo.

if not exist "node_modules" (
  echo [!] 아직 설치가 안 됐습니다.
  echo     설치.bat 을 먼저 더블클릭해 주세요.
  echo.
  pause
  exit /b 1
)

echo 앱을 켜는 중입니다. 잠시 뒤 브라우저가 저절로 열립니다.
echo 안 열리면 브라우저 주소창에 이걸 직접 쳐주세요:  http://localhost:4123
echo.
start "" /min cmd /c "timeout /t 6 >nul && start http://localhost:4123"
call npm run dev

echo.
echo 앱이 꺼졌습니다.
pause
