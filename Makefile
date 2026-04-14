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
	@echo "$(GREEN)Cloud Run Commands:$(NC)"
	@echo "  make deploy       - Full deploy (setup + build + deploy)"
	@echo "  make deploy-setup - One-time GCP setup"
	@echo "  make deploy-build - Build & push Docker images"
	@echo "  make deploy-backend  - Deploy backend to Cloud Run"
	@echo "  make deploy-frontend - Deploy frontend to Cloud Run"
	@echo "  make deploy-status   - Show Cloud Run status"
	@echo "  make deploy-teardown - Delete Cloud Run services"
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

# ================================
# Cloud Run Deployment Commands
# ================================

# Configuration
GCP_PROJECT ?= vernal-citadel-479904-i2
GCP_REGION ?= us-central1
AR_REPO ?= $(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT)/ipat

## deploy-setup: One-time setup for Cloud Run deployment
deploy-setup:
	@echo "$(BLUE)Setting up Cloud Run deployment...$(NC)"
	gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --project=$(GCP_PROJECT)
	gcloud artifacts repositories create ipat --repository-format=docker --location=$(GCP_REGION) --project=$(GCP_PROJECT) 2>/dev/null || echo "$(YELLOW)Repository already exists$(NC)"
	gcloud auth configure-docker $(GCP_REGION)-docker.pkg.dev --quiet
	@echo "$(GREEN)✓ Setup complete!$(NC)"

## deploy-build: Build and push Docker images to Artifact Registry
deploy-build:
	@echo "$(BLUE)Building and pushing images...$(NC)"
	@echo "Building backend..."
	docker build -t $(AR_REPO)/ipat-backend:latest --target production ./backend
	docker push $(AR_REPO)/ipat-backend:latest
	@echo "Building frontend..."
	docker build -t $(AR_REPO)/ipat-frontend:latest --target production \
		--build-arg NEXT_PUBLIC_API_URL=$$(gcloud run services describe ipat-backend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='value(status.url)' 2>/dev/null || echo "https://ipat-backend-placeholder.run.app") \
		./frontend
	docker push $(AR_REPO)/ipat-frontend:latest
	@echo "$(GREEN)✓ Images built and pushed!$(NC)"

## deploy-backend: Deploy backend to Cloud Run
deploy-backend:
	@echo "$(BLUE)Deploying backend to Cloud Run...$(NC)"
	gcloud run deploy ipat-backend \
		--image=$(AR_REPO)/ipat-backend:latest \
		--region=$(GCP_REGION) \
		--project=$(GCP_PROJECT) \
		--platform=managed \
		--port=8010 \
		--memory=2Gi \
		--cpu=2 \
		--timeout=300 \
		--max-instances=10 \
		--min-instances=0 \
		--allow-unauthenticated \
		--set-env-vars="GCP_PROJECT_ID=$(GCP_PROJECT),GCP_DATASET_ID=ipat_dataset,LOG_LEVEL=WARNING" \
		--service-account=$(shell gcloud iam service-accounts list --project=$(GCP_PROJECT) --filter="email~ipat" --format="value(email)" 2>/dev/null || echo "default")
	@echo "$(GREEN)✓ Backend deployed!$(NC)"
	@echo "$(BLUE)Backend URL:$(NC)"
	@gcloud run services describe ipat-backend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='value(status.url)'

## deploy-frontend: Deploy frontend to Cloud Run (run after backend)
deploy-frontend:
	@echo "$(BLUE)Deploying frontend to Cloud Run...$(NC)"
	$(eval BACKEND_URL := $(shell gcloud run services describe ipat-backend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='value(status.url)'))
	@echo "Backend URL: $(BACKEND_URL)"
	@echo "Rebuilding frontend with backend URL..."
	docker build -t $(AR_REPO)/ipat-frontend:latest --target production \
		--build-arg NEXT_PUBLIC_API_URL=$(BACKEND_URL) \
		./frontend
	docker push $(AR_REPO)/ipat-frontend:latest
	gcloud run deploy ipat-frontend \
		--image=$(AR_REPO)/ipat-frontend:latest \
		--region=$(GCP_REGION) \
		--project=$(GCP_PROJECT) \
		--platform=managed \
		--port=3010 \
		--memory=1Gi \
		--cpu=1 \
		--timeout=60 \
		--max-instances=5 \
		--min-instances=0 \
		--allow-unauthenticated \
		--set-env-vars="NODE_ENV=production"
	@echo "$(GREEN)✓ Frontend deployed!$(NC)"
	@echo "$(BLUE)Frontend URL:$(NC)"
	@gcloud run services describe ipat-frontend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='value(status.url)'

## deploy: Full deployment (build + deploy backend + frontend)
deploy: deploy-setup deploy-build deploy-backend deploy-frontend
	@echo ""
	@echo "$(GREEN)================================$(NC)"
	@echo "$(GREEN)Cloud Run Deployment Complete!$(NC)"
	@echo "$(GREEN)================================$(NC)"
	@echo "$(BLUE)Backend: $(NC)$$(gcloud run services describe ipat-backend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='value(status.url)')"
	@echo "$(BLUE)Frontend:$(NC)$$(gcloud run services describe ipat-frontend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='value(status.url)')"
	@echo "$(GREEN)================================$(NC)"

## deploy-update-cors: Update backend CORS to allow the frontend URL
deploy-update-cors:
	$(eval FRONTEND_URL := $(shell gcloud run services describe ipat-frontend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='value(status.url)'))
	@echo "$(BLUE)Updating backend CORS for $(FRONTEND_URL)...$(NC)"
	gcloud run services update ipat-backend \
		--region=$(GCP_REGION) \
		--project=$(GCP_PROJECT) \
		--update-env-vars="CORS_ORIGINS=$(FRONTEND_URL)"
	@echo "$(GREEN)✓ CORS updated!$(NC)"

## deploy-status: Show Cloud Run deployment status
deploy-status:
	@echo "$(BLUE)Cloud Run Services:$(NC)"
	@echo ""
	@echo "$(GREEN)Backend:$(NC)"
	@gcloud run services describe ipat-backend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='table(status.url, status.conditions[0].status)' 2>/dev/null || echo "  Not deployed"
	@echo ""
	@echo "$(GREEN)Frontend:$(NC)"
	@gcloud run services describe ipat-frontend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --format='table(status.url, status.conditions[0].status)' 2>/dev/null || echo "  Not deployed"

## deploy-teardown: Delete Cloud Run services
deploy-teardown:
	@echo "$(YELLOW)This will delete Cloud Run services!$(NC)"
	@read -p "Are you sure? [y/N]: " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		gcloud run services delete ipat-backend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --quiet 2>/dev/null || true; \
		gcloud run services delete ipat-frontend --region=$(GCP_REGION) --project=$(GCP_PROJECT) --quiet 2>/dev/null || true; \
		echo "$(GREEN)✓ Services deleted$(NC)"; \
	else \
		echo "$(YELLOW)Cancelled$(NC)"; \
	fi
