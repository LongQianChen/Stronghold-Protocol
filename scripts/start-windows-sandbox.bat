@echo off
rem Stronghold Protocol - double-click to start with the plugin script sandbox on (Windows). Docs: docs\DEPLOY.md
rem The same as  start-windows.bat --scripts sandbox  (SP_PLUGIN_SCRIPTS=sandbox, docs\PLUGINS.md section 13): script
rem plugins run in the SES sandbox when a room selects them. Extra arguments are passed on, e.g. --port 3001.
call "%~dp0start-windows.bat" --scripts sandbox %*
