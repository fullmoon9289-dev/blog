@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 네이버 블로그 자동화 - 설치
echo.
echo ================================================
echo   네이버 블로그 자동화 - 설치
echo ================================================
echo.

rem 압축 파일 안에서 그대로 실행하면 임시 폴더에서 돌다가 전부 사라집니다.
echo %~dp0 | findstr /i "\\Temp\\" >nul
if not errorlevel 1 (
  echo [!] 지금 압축 파일 안에서 실행되고 있습니다.
  echo.
  echo     이대로 두면 한참 기다린 뒤에 전부 사라집니다.
  echo     1. 이 창을 닫으세요
  echo     2. 내려받은 zip 파일에 오른쪽 버튼 - 압축 풀기 를 하세요
  echo     3. 풀린 폴더로 들어가서 설치.bat 을 다시 더블클릭하세요
  echo.
  pause
  exit /b 1
)

echo 필요한 것들을 내려받습니다. 처음에는 5~10분쯤 걸립니다.
echo 이 창을 닫지 말고 기다려 주세요.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] 프로그램 실행기^(Node.js^)가 없습니다.
  echo.
  echo     1. https://nodejs.org 에 접속하세요
  echo     2. 왼쪽의 LTS 버튼을 눌러 내려받아 설치하세요
  echo     3. 설치가 끝나면 이 창을 닫고, 설치.bat 을 다시 더블클릭하세요
  echo.
  pause
  exit /b 1
)

where claude >nul 2>nul
if errorlevel 1 (
  echo [i] AI 프로그램을 설치합니다. 2~3분 걸립니다.
  call npm install -g @anthropic-ai/claude-code
  echo.
  echo [!] 설치가 끝났습니다. 이제 AI 에 로그인해야 합니다.
  echo.
  echo     1. 이 창을 닫으세요
  echo     2. 시작 버튼을 누르고 터미널 이라고 검색해 여세요
  echo     3. claude 라고 치고 엔터를 누른 뒤, 안내에 따라 로그인하세요
  echo     4. 로그인이 끝나면 설치.bat 을 다시 더블클릭하세요
  echo.
  pause
  exit /b 1
)

echo [1/3] 필요한 프로그램을 내려받는 중...
call npm install
if errorlevel 1 goto failed

echo.
echo [2/3] 자동 브라우저를 준비하는 중...
call npx playwright install chromium
if errorlevel 1 goto failed

echo.
echo [3/3] 준비물을 하나씩 확인하는 중...
call npm run doctor
if errorlevel 1 goto notready

echo.
echo ================================================
echo   준비 끝!  이제 실행.bat 을 더블클릭하세요.
echo ================================================
echo.
pause
exit /b 0

:notready
echo.
echo 위에 X 표시가 있는 줄의 화살표를 따라 해주세요.
echo 그다음 설치.bat 을 다시 더블클릭하시면 됩니다.
echo.
pause
exit /b 1

:failed
echo.
echo ================================================
echo   부품을 내려받다가 멈췄습니다
echo ================================================
echo.
echo 먼저 설치.bat 을 한 번 더 더블클릭해 보세요.
echo 일시적인 문제였다면 두 번째에 그냥 넘어갑니다.
echo.
echo 그래도 같은 곳에서 멈추면, 위로 올려서 빨간 글씨가
echo 처음 나오는 부분을 찍어서 알려주세요.
echo 어떤 부품이 문제인지 제가 보고 고쳐드리겠습니다.
echo.
pause
exit /b 1
