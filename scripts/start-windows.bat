@echo off
rem Stronghold Protocol - double-click to start (Windows). Docs: docs\DEPLOY.md
rem Checks Node.js, installs dependencies on the first run, runs tools\setup.mjs (art download / resume),
rem starts the server, prints the LAN addresses and opens the browser. Extra arguments are passed to
rem scripts\launch.mjs, e.g.:  start-windows.bat --port 3001 --no-local
chcp 65001 >nul
setlocal EnableExtensions
title 卫戍协议：盟约 - Stronghold Protocol
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(Math.max(0, Math.sign(22 - parseInt(process.versions.node))))"
if errorlevel 1 goto :oldnode

if not exist "node_modules\ws\package.json" (
  echo [首次运行] 正在安装依赖 npm ci ...
  call npm ci --no-audit --no-fund || call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

node scripts\launch.mjs %*
if errorlevel 1 goto :fail
exit /b 0

:nonode
echo.
echo 未找到 Node.js（需要 22 或更高，22 / 24 LTS）。Node.js not found.
echo.
echo   方法一：在 PowerShell 或命令提示符中运行
echo       winget install OpenJS.NodeJS.LTS
echo   方法二：从官网下载安装包  https://nodejs.org/zh-cn/download
echo.
echo 安装完成后请关闭本窗口，再重新双击 start-windows.bat。
echo.
pause
exit /b 1

:oldnode
echo.
for /f "delims=" %%v in ('node -v') do echo 当前 Node.js 版本 %%v 太旧，需要 22 或更高（22 / 24 LTS）。
echo   升级：winget upgrade OpenJS.NodeJS.LTS   或   https://nodejs.org/zh-cn/download
echo.
pause
exit /b 1

:fail
echo.
echo 启动失败，请查看上面的错误信息。诊断：node tools\doctor.mjs
echo Start failed - see the messages above. Diagnose with: node tools\doctor.mjs
echo.
pause
exit /b 1
