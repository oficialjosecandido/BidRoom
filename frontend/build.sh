#!/bin/bash

# Custom build script for Azure Static Web Apps
# This script ensures we use Node.js 20

echo "Setting up Node.js 20..."
# Use nvm to switch to Node.js 20
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20

echo "Node.js version:"
node --version

echo "Installing dependencies..."
npm ci

echo "Building Angular application..."
npm run build

echo "Build completed successfully!"
