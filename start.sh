#!/bin/bash
echo "🚀 Starting LeadFinder..."
echo "📡 Open your browser and go to: http://localhost:3000"
echo "   Press Ctrl+C to stop the server"
echo ""
open "http://localhost:3000"
python3 -m http.server 3000
