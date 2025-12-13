#!/bin/bash

echo "========================================="
echo "IPAT Segmentation Analysis Setup Script"
echo "========================================="
echo ""

# Check if conda environment is active
if [[ "$CONDA_DEFAULT_ENV" != "ipat" ]]; then
    echo "⚠️  Conda environment 'ipat' is not active."
    echo "Please run: conda activate ipat"
    exit 1
fi

echo "✓ Conda environment 'ipat' is active"
echo ""

# Install backend dependencies
echo "Installing backend dependencies..."
cd backend
pip install -r requirements.txt
cd ..
echo "✓ Backend dependencies installed"
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL is not installed. Please install it first."
    exit 1
fi

echo "✓ PostgreSQL is installed"
echo ""

# Create database if it doesn't exist
echo "Setting up database..."
if ! psql -lqt | cut -d \| -f 1 | grep -qw ipat_db; then
    createdb ipat_db
    echo "✓ Database 'ipat_db' created"
else
    echo "✓ Database 'ipat_db' already exists"
fi
echo ""

# Run SQL initialization
echo "Initializing database function..."
psql -d ipat_db -f backend/db/init.sql
echo "✓ Database function created"
echo ""

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd frontend
npm install
cd ..
echo "✓ Frontend dependencies installed"
echo ""

echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "To start the application:"
echo ""
echo "Terminal 1 (Backend):"
echo "  cd backend"
echo "  python main.py"
echo ""
echo "Terminal 2 (Frontend):"
echo "  cd frontend"
echo "  npm run dev"
echo ""
echo "Then open: http://localhost:3010"
echo ""
