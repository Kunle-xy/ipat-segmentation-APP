#!/bin/bash

# IPAT Application - Docker Quick Start Script
# This script helps you set up and run the IPAT application with Docker

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"

    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_success "Docker is installed"

    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    print_success "Docker Compose is installed"

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        print_error "Cannot connect to the Docker daemon. Check daemon status and access to the Docker socket."
        exit 1
    fi
    print_success "Docker daemon is running"
}

# Setup environment
setup_environment() {
    print_header "Setting Up Environment"

    local mode=${1:-development}

    # Check if .env exists
    if [ ! -f .env ]; then
        print_info "Creating .env file from .env.example..."
        cp .env.example .env
        print_info ".env created from .env.example"
    else
        print_success ".env file exists"
    fi

    if [ "$mode" != production ]; then
        return
    fi

    # Check if GCP credentials exist
    if [ ! -f backend/gcp-service-account.json ]; then
        print_warning "GCP service account file not found!"
        print_info "Please place your service account JSON file at:"
        echo "  backend/gcp-service-account.json"
        echo ""
        return 1
    else
        print_success "GCP credentials found"
    fi
}

# Build and start services
start_services() {
    print_header "Starting Services"

    MODE=${1:-development}

    if [ "$MODE" = "production" ]; then
        print_info "Starting in PRODUCTION mode..."
        docker compose -f docker-compose.prod.yml up --build -d
    else
        print_info "Starting in DEVELOPMENT mode..."
        docker compose up --build -d
    fi

    print_success "Services started successfully!"
}

# Show service status
show_status() {
    print_header "Service Status"
    docker compose ps
}

# Show logs
show_logs() {
    print_header "Service Logs"
    docker compose logs -f
}

# Stop services
stop_services() {
    print_header "Stopping Services"
    docker compose down
    print_success "Services stopped"
}

# Clean up
cleanup() {
    print_header "Cleaning Up"
    print_warning "This will remove all containers, volumes, and images!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker compose down -v --rmi all
        print_success "Cleanup complete"
    else
        print_info "Cleanup cancelled"
    fi
}

# Show application URLs
show_urls() {
    print_header "Application URLs"
    echo -e "${GREEN}Frontend:${NC}    http://localhost:3010"
    echo -e "${GREEN}Backend API:${NC} http://localhost:8010"
    echo -e "${GREEN}API Docs:${NC}    http://localhost:8010/docs"
}

# Main menu
show_menu() {
    echo ""
    print_header "IPAT Docker Manager"
    echo "1. Start services (Development)"
    echo "2. Start services (Production)"
    echo "3. Stop services"
    echo "4. View logs"
    echo "5. View status"
    echo "6. Restart services"
    echo "7. Clean up"
    echo "8. Show URLs"
    echo "9. Exit"
    echo ""
}

# Main script
main() {
    if [ -t 1 ] && [ -n "${TERM:-}" ]; then
        clear
    fi
    print_header "IPAT Application - Docker Setup"

    # Check prerequisites
    check_prerequisites

    # If argument provided, execute directly
    if [ $# -gt 0 ]; then
        case "$1" in
            start)
                setup_environment
                start_services development
                show_urls
                ;;
            start-prod)
                setup_environment production
                start_services production
                show_urls
                ;;
            stop)
                stop_services
                ;;
            logs)
                show_logs
                ;;
            status)
                show_status
                ;;
            clean)
                cleanup
                ;;
            *)
                echo "Unknown command: $1"
                echo "Usage: $0 {start|start-prod|stop|logs|status|clean}"
                exit 1
                ;;
        esac
        exit 0
    fi

    # Interactive mode
    while true; do
        show_menu
        read -p "Select an option (1-9): " choice

        case $choice in
            1)
                setup_environment
                start_services development
                show_urls
                ;;
            2)
                setup_environment production
                start_services production
                show_urls
                ;;
            3)
                stop_services
                ;;
            4)
                show_logs
                ;;
            5)
                show_status
                ;;
            6)
                docker compose restart
                print_success "Services restarted"
                ;;
            7)
                cleanup
                ;;
            8)
                show_urls
                ;;
            9)
                print_info "Goodbye!"
                exit 0
                ;;
            *)
                print_error "Invalid option"
                ;;
        esac

        echo ""
        read -p "Press Enter to continue..."
    done
}

# Run main function
main "$@"
