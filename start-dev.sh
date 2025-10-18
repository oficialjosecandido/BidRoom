#!/bin/bash

# BidRoom Development Startup Script

echo "🚀 Starting BidRoom Development Environment..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js (LTS version) first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo ""

# Start Backend
echo "🔧 Starting Backend Server..."
cd backend
npm run dev &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start Frontend
echo "🎨 Starting Frontend Server..."
cd ../frontend
npm start &
FRONTEND_PID=$!

echo ""
echo "🎉 BidRoom is now running!"
echo ""
echo "📊 Backend API: http://localhost:3000"
echo "🎨 Frontend App: http://localhost:4200"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user to stop
wait

# Cleanup on exit
echo ""
echo "🛑 Stopping servers..."
kill $BACKEND_PID 2>/dev/null
kill $FRONTEND_PID 2>/dev/null
echo "✅ All servers stopped"
