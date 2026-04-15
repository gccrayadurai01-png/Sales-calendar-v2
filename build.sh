#!/bin/bash
set -e
echo "==> Installing backend dependencies..."
npm install --prefix backend

echo "==> Installing frontend dependencies..."
cd frontend
npm install

echo "==> Building frontend..."
./node_modules/.bin/vite build

echo "==> Build complete!"
