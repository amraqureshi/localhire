@echo off
echo ========================================================
echo Starting LocalHire Backend (Port 5000) and Frontend (Port 5500)...
echo ========================================================

start "LocalHire Backend API (Port 5000)" cmd /k "cd server && node server.js"
start "LocalHire Frontend (Port 5500)" cmd /k "node serve.js"

echo Services started in new terminal windows!
echo Backend:  http://localhost:5000
echo Frontend: http://localhost:5500
echo ========================================================
