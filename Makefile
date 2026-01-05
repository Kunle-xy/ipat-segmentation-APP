.PHONY: help build up down restart logs status clean dev prod

# Default target
.DEFAULT_GOAL := help

# Colors
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m # No Color

## help: Display this help message
help:
	@echo "$(BLUE)IPAT Application - Make Commands$(NC)"
	@echo ""
	@echo "$(GREEN)Development Commands:$(NC)"
	@echo "  make dev          - Start in development mode"
	@echo "  make logs         - View logs (follow mode)"
	@echo "  make logs-backend - View backend logs only"
	@echo "  make logs-frontend- View frontend logs only"
	@echo "  make restart      - Restart all services"
	@echo "  make down         - Stop all services"
	@echo ""
	@echo "$(GREEN)Testing Commands:$(NC)"
	@echo "  make test         - Run all tests (backend + frontend)"
	@echo "  make test-backend - Run backend tests only"
	@echo "  make test-frontend- Run frontend tests only"
	@echo "  make lint         - Run linting (backend + frontend)"
	@echo ""
	@echo "$(GREEN)Production Commands:$(NC)"
	@echo "  make prod         - Start in production mode"
	@echo "  make prod-down    - Stop production services"
	@echo "  make prod-logs    - View production logs"
	@echo ""
	@echo "$(GREEN)Utility Commands:$(NC)"
	@echo "  make status       - Show service status"
	@echo "  make shell-backend- Shell into backend container"
	@echo "  make shell-frontend- Shell into frontend container"
	@echo "  make clean        - Remove containers and volumes"
	@echo "  make prune        - Clean unused Docker resources"
	@echo "  make setup        - Initial environment setup"
	@echo ""

## setup: Initial setup - create .env from template
setup:
	@if [ ! -f .env ]; then \
		echo "$(YELLOW)Creating .env from .env.example...$(NC)"; \
		cp .env.example .env; \
		echo "$(GREEN)✓ .env created. Please update it with your values!$(NC)"; \
	else \
		echo "$(YELLOW).env already exists$(NC)"; \
	fi
	@if [ ! -f backend/gcp-service-account.json ]; then \
		echo "$(YELLOW)⚠ Don't forget to add backend/gcp-service-account.json$(NC)"; \
	fi

## dev: Start services in development mode
dev: setup
	@echo "$(BLUE)Starting services in development mode...$(NC)"
	docker compose up --build -d
	@echo "$(GREEN)✓ Services started!$(NC)"
	@make urls

## prod: Start services in production mode
prod: setup
	@echo "$(BLUE)Starting services in production mode...$(NC)"
	docker compose -f docker-compose.prod.yml up --build -d
	@echo "$(GREEN)✓ Production services started!$(NC)"
	@make urls

## up: Alias for dev
up: dev

## build: Build all services
build:
	@echo "$(BLUE)Building services...$(NC)"
	docker compose build
	@echo "$(GREEN)✓ Build complete!$(NC)"

## down: Stop all services
down:
	@echo "$(BLUE)Stopping services...$(NC)"
	docker compose down
	@echo "$(GREEN)✓ Services stopped$(NC)"

## prod-down: Stop production services
prod-down:
	@echo "$(BLUE)Stopping production services...$(NC)"
	docker compose -f docker-compose.prod.yml down
	@echo "$(GREEN)✓ Production services stopped$(NC)"

## restart: Restart all services
restart:
	@echo "$(BLUE)Restarting services...$(NC)"
	docker compose restart
	@echo "$(GREEN)✓ Services restarted$(NC)"

## logs: View logs (follow mode)
logs:
	docker compose logs -f

## logs-backend: View backend logs only
logs-backend:
	docker compose logs -f backend

## logs-frontend: View frontend logs only
logs-frontend:
	docker compose logs -f frontend

## prod-logs: View production logs
prod-logs:
	docker compose -f docker-compose.prod.yml logs -f

## status: Show service status
status:
	@echo "$(BLUE)Service Status:$(NC)"
	docker compose ps

## shell-backend: Open shell in backend container
shell-backend:
	docker compose exec backend bash

## shell-frontend: Open shell in frontend container
shell-frontend:
	docker compose exec frontend sh

## clean: Remove containers and volumes
clean:
	@echo "$(YELLOW)This will remove all containers and volumes!$(NC)"
	@read -p "Are you sure? [y/N]: " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker compose down -v; \
		echo "$(GREEN)✓ Cleanup complete$(NC)"; \
	else \
		echo "$(YELLOW)Cleanup cancelled$(NC)"; \
	fi

## prune: Clean unused Docker resources
prune:
	@echo "$(YELLOW)Cleaning unused Docker resources...$(NC)"
	docker system prune -f
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

## health: Check health status of services
health:
	@echo "$(BLUE)Checking service health...$(NC)"
	@echo ""
	@echo "Backend:"
	@curl -f http://localhost:8010/health 2>/dev/null || echo "$(YELLOW)Backend not responding$(NC)"
	@echo ""
	@echo "Frontend:"
	@curl -f http://localhost:3010 2>/dev/null && echo "$(GREEN)✓ Frontend is up$(NC)" || echo "$(YELLOW)Frontend not responding$(NC)"

## urls: Show application URLs
urls:
	@echo ""
	@echo "$(GREEN)================================$(NC)"
	@echo "$(GREEN)Application URLs:$(NC)"
	@echo "$(GREEN)================================$(NC)"
	@echo "$(BLUE)Frontend:    $(NC)http://localhost:3010"
	@echo "$(BLUE)Backend API: $(NC)http://localhost:8010"
	@echo "$(BLUE)API Docs:    $(NC)http://localhost:8010/docs"
	@echo "$(GREEN)================================$(NC)"
	@echo ""

## test: Run tests (placeholder)
test:
	@echo "$(BLUE)Running tests...$(NC)"
	@echo "$(YELLOW)Test suite not yet implemented$(NC)"

## backup: Backup environment and credentials
backup:
	@mkdir -p backups
	@BACKUP_DATE=$$(date +%Y%m%d_%H%M%S); \
	echo "$(BLUE)Creating backup...$(NC)"; \
	cp .env "backups/env_$$BACKUP_DATE.backup" 2>/dev/null || true; \
	cp backend/gcp-service-account.json "backups/gcp_creds_$$BACKUP_DATE.json" 2>/dev/null || true; \
	echo "$(GREEN)✓ Backup created in backups/ directory$(NC)"

## update: Pull latest code and rebuild
update:
	@echo "$(BLUE)Updating application...$(NC)"
	git pull
	docker compose up --build -d
	@echo "$(GREEN)✓ Update complete!$(NC)"

# ================================
# Testing Commands
# ================================

## test: Run all tests
test: test-backend test-frontend
	@echo "$(GREEN)✓ All tests complete!$(NC)"

## test-backend: Run backend tests
test-backend:
	@echo "$(BLUE)Running backend tests...$(NC)"
	cd backend && pip install -q pytest pytest-cov && pytest tests/ -v --tb=short
	@echo "$(GREEN)✓ Backend tests complete!$(NC)"

## test-frontend: Run frontend tests
test-frontend:
	@echo "$(BLUE)Running frontend tests...$(NC)"
	cd frontend && npm test -- --passWithNoTests
	@echo "$(GREEN)✓ Frontend tests complete!$(NC)"

## test-backend-cov: Run backend tests with coverage
test-backend-cov:
	@echo "$(BLUE)Running backend tests with coverage...$(NC)"
	cd backend && pytest tests/ --cov=. --cov-report=term-missing --cov-report=html

## test-frontend-cov: Run frontend tests with coverage
test-frontend-cov:
	@echo "$(BLUE)Running frontend tests with coverage...$(NC)"
	cd frontend && npm run test:coverage

## lint: Run linting on backend and frontend
lint: lint-backend lint-frontend
	@echo "$(GREEN)✓ Linting complete!$(NC)"

## lint-backend: Run backend linting
lint-backend:
	@echo "$(BLUE)Linting backend...$(NC)"
	cd backend && pip install -q flake8 black && flake8 . --max-line-length=127 --exclude=__pycache__,tests && black --check .
	@echo "$(GREEN)✓ Backend linting complete!$(NC)"

## lint-frontend: Run frontend linting
lint-frontend:
	@echo "$(BLUE)Linting frontend...$(NC)"
	cd frontend && npm run lint
	@echo "$(GREEN)✓ Frontend linting complete!$(NC)"

## format: Auto-format code
format:
	@echo "$(BLUE)Formatting code...$(NC)"
	cd backend && pip install -q black && black .
	@echo "$(GREEN)✓ Code formatted!$(NC)"
