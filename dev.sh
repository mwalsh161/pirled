#!/bin/bash
# Development: Run both API and React dev server

echo "Starting PIR LED Controller..."
echo ""
echo "API server running on http://localhost:8000"
echo "React dev server running on http://localhost:5173"
echo ""

# Start Python API server in background
cd "$(dirname "$0")"
api/launch.sh &
API_PID=$!

echo "PID: $API_PID"

# Cleanup on exit
trap "kill $API_PID" EXIT

# Start React dev server
cd "$(dirname "$0")/frontend"
npm run dev
