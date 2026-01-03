# IPAT Docker Deployment Guide

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- Google Cloud Platform service account with BigQuery permissions
- At least 4GB of available RAM

## Quick Start

### 1. Initial Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your actual values
nano .env  # or use your preferred editor
```

### 2. Add GCP Credentials

Place your Google Cloud service account JSON file in the backend directory:

```bash
cp /path/to/your/service-account.json backend/gcp-service-account.json
```

**Important:** Ensure the file is named `gcp-service-account.json` or update the path in `.env`

### 3. Development Mode

```bash
# Build and start services
docker-compose up --build

# Or run in background
docker-compose up --build -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The application will be available at:
- Frontend: http://localhost:3010
- Backend API: http://localhost:8010
- API Docs: http://localhost:8010/docs

### 4. Production Mode

```bash
# Build and start in production mode
docker-compose -f docker-compose.prod.yml up --build -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop services
docker-compose -f docker-compose.prod.yml down
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID | `my-project-123` |
| `GCP_DATASET_ID` | BigQuery dataset name | `ipat_dataset` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON | `/app/gcp-service-account.json` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_PORT` | `8010` | Backend API port |
| `FRONTEND_PORT` | `3010` | Frontend port |
| `CORS_ORIGINS` | `http://localhost:3010` | Allowed CORS origins |
| `LOG_LEVEL` | `INFO` | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `NODE_ENV` | `development` | Node environment |
| `BACKEND_RELOAD` | `true` | Enable hot-reload for backend |

## Docker Commands Cheat Sheet

```bash
# Build services without cache
docker-compose build --no-cache

# Rebuild a specific service
docker-compose build backend

# View running containers
docker-compose ps

# Execute command in container
docker-compose exec backend bash
docker-compose exec frontend sh

# View logs for specific service
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart a specific service
docker-compose restart backend

# Stop all services
docker-compose stop

# Remove containers and volumes
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

## Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
lsof -i :8010  # Backend
lsof -i :3010  # Frontend

# Kill the process or change ports in .env
```

### Permission Denied for GCP Credentials

```bash
# Fix file permissions
chmod 600 backend/gcp-service-account.json
```

### Backend Health Check Failing

```bash
# Check backend logs
docker-compose logs backend

# Verify GCP credentials are correct
docker-compose exec backend cat /app/gcp-service-account.json

# Test BigQuery connection
docker-compose exec backend python -c "from google.cloud import bigquery; client = bigquery.Client(); print('Connected!')"
```

### Frontend Can't Connect to Backend

```bash
# Verify network connectivity
docker-compose exec frontend ping backend

# Check NEXT_PUBLIC_API_URL in frontend
docker-compose exec frontend env | grep API_URL

# Rebuild frontend with correct env
docker-compose up --build frontend
```

## Production Deployment

### Security Checklist

- [ ] Use production-ready GCP credentials with minimal permissions
- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Set `BACKEND_RELOAD=false` in `.env`
- [ ] Update `CORS_ORIGINS` to your production domain
- [ ] Use HTTPS for frontend and backend
- [ ] Implement rate limiting on backend
- [ ] Set up monitoring and logging
- [ ] Regular security updates for Docker images
- [ ] Use secrets management for sensitive data
- [ ] Enable firewall rules for production servers

### Resource Limits

Production compose file includes resource limits:
- Backend: 1-2 CPU cores, 1-2GB RAM
- Frontend: 0.5-1 CPU cores, 512MB-1GB RAM

Adjust these in `docker-compose.prod.yml` based on your needs.

### Monitoring

```bash
# Check resource usage
docker stats

# View health status
docker-compose ps
```

## Development Workflow

### Hot Reload

Both frontend and backend support hot-reload in development mode:
- Backend: Code changes automatically reload uvicorn
- Frontend: Next.js Fast Refresh updates the browser

### Debugging

```bash
# View detailed logs
docker-compose logs --tail=100 -f backend

# Access container shell
docker-compose exec backend bash
docker-compose exec frontend sh

# Check environment variables
docker-compose exec backend env
docker-compose exec frontend env
```

## Backup and Restore

### Backup GCP Credentials

```bash
# Backup credentials
cp backend/gcp-service-account.json ~/backups/gcp-credentials-$(date +%Y%m%d).json
```

### Environment Backup

```bash
# Backup environment file
cp .env .env.backup
```

## Cleanup

```bash
# Remove all stopped containers
docker container prune

# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Full cleanup (WARNING: removes everything)
docker system prune -a --volumes
```

## Support

For issues:
1. Check logs: `docker-compose logs -f`
2. Verify `.env` configuration
3. Ensure GCP credentials are valid
4. Check GitHub issues
5. Contact support team

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Google Cloud BigQuery Documentation](https://cloud.google.com/bigquery/docs)
