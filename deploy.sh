#!/bin/bash

echo "🚀 Deploying Tanner.xyz updates..."

# Navigate to frontend
cd frontend

# Install dependencies (if needed)
echo "📦 Installing dependencies..."
npm install

# Build the frontend
echo "🔨 Building frontend..."
npm run build

# Go back to root
cd ..

# Restart the backend server
echo "🔄 Restarting backend server..."
pm2 restart all || (pkill -f "node server.js" && nohup node server.js > server.log 2>&1 &)

echo "✅ Deployment complete!"
echo "🌐 Visit: http://92.246.141.205:3001"
