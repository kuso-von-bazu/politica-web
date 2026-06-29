@echo off
chcp 65001 >nul
rem POLITICA -ポリティカ- 起動スクリプト
rem ローカルHTTPサーバを立ててブラウザで開く(画像読み込みのためfile://でなくhttpで起動)。
cd /d "%~dp0"

rem 空いていそうなポート
set PORT=8770

echo POLITICA を起動します...  http://localhost:%PORT%/
start "" http://localhost:%PORT%/index.html

rem python が無い場合は index.html を直接開く
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
) else (
  echo python が見つかりません。index.html を直接開きます。
  start "" "%~dp0index.html"
)
