@echo off
REM Lance le serveur local puis ouvre le jeu dans le navigateur par defaut.
cd /d "%~dp0"
start "" http://localhost:4173
node server.js
