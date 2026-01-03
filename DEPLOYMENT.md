# IPAT Application - Production Deployment Guide

## Overview

This guide covers deploying the IPAT application in a production environment using Docker.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Production Setup                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │   Frontend   │ ◄─────► │   Backend    │                 │
│  │  (Next.js)   │         │  (FastAPI)   │                 │
│  │   Port 3010  │         │   Port 8010  │                 │
│  └──────────────┘         └──────┬───────┘                 │
│                                   │                          │
│                                   ▼                          │
│                          ┌─────────────────┐                │
│                          │ Google BigQuery │                │
│                          └─────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

### System Requirements

- **OS**: Ubuntu 20.04+, Debian 11+, or RHEL 8+
- **RAM**: Minimum 4GB (8GB recommended)
- **CPU**: 2+ cores (4+ recommended)
- **Disk**: 20GB+ free space
- **Docker**: 20.10+
- **Docker Compose**: 2.0+

### Google Cloud Platform

- GCP Project with BigQuery API enabled
- Service Account with following roles:
  - `roles/bigquery.dataEditor`
  - `roles/bigquery.jobUser`
- Service Account JSON key file

## Installation Steps

### 1. Clone Repository

```bash
git clone <repository-url>
cd IPAT_II/APP
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

Required environment variables:

```bash
# GCP Configuration
GCP_PROJECT_ID=your-gcp-project-id
GCP_DATASET_ID=ipat_dataset
GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-service-account.json

# Application Ports
BACKEND_PORT=8010
FRONTEND_PORT=3010

# Production Settings
NODE_ENV=production
BACKEND_RELOAD=false
LOG_LEVEL=WARNING

# CORS (set to your domain)
CORS_ORIGINS=https://yourdomain.com

# API URL (set to your backend URL)
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

### 3. Add GCP Credentials

```bash
# Copy your service account JSON file
cp /path/to/your-service-account.json backend/gcp-service-account.json

# Set proper permissions
chmod 600 backend/gcp-service-account.json
```

### 4. Deploy with Docker

```bash
# Build and start services in production mode
docker compose -f docker-compose.prod.yml up --build -d

# Verify services are running
docker compose -f docker-compose.prod.yml ps

# Check logs
docker compose -f docker-compose.prod.yml logs -f
```

Or use the convenient start script:

```bash
./start.sh start-prod
```

## Production Checklist

### Security

- [ ] Use strong, unique passwords
- [ ] Enable HTTPS/TLS for all endpoints
- [ ] Restrict CORS origins to your domain only
- [ ] Use minimal GCP service account permissions
- [ ] Keep Docker images updated
- [ ] Implement rate limiting
- [ ] Enable firewall rules
- [ ] Use secrets management (not .env in production)
- [ ] Regular security audits

### Performance

- [ ] Configure resource limits in docker-compose
- [ ] Enable Docker logging drivers
- [ ] Set up log rotation
- [ ] Configure reverse proxy (Nginx/Traefik)
- [ ] Enable HTTP/2 and gzip compression
- [ ] Implement caching strategies
- [ ] Monitor resource usage

### Monitoring

- [ ] Set up application monitoring (Prometheus/Grafana)
- [ ] Configure health checks
- [ ] Set up log aggregation (ELK/Loki)
- [ ] Create alerts for failures
- [ ] Monitor BigQuery usage and costs
- [ ] Track API response times

### Backup

- [ ] Regular .env file backups (encrypted)
- [ ] GCP credentials backup (encrypted)
- [ ] Document recovery procedures
- [ ] Test restore procedures

## Reverse Proxy Setup (Nginx)

### Install Nginx

```bash
sudo apt-get update
sudo apt-get install nginx certbot python3-certbot-nginx
```

### Configure Nginx

Create `/etc/nginx/sites-available/ipat`:

```nginx
# Backend API
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:8010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for long-running requests
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}

# Frontend
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support for Next.js HMR
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and restart:

```bash
sudo ln -s /etc/nginx/sites-available/ipat /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Enable HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com -d api.yourdomain.com
```

## Monitoring Setup

### Docker Stats

```bash
# View resource usage
docker stats

# View logs
docker compose -f docker-compose.prod.yml logs -f

# View specific service logs
docker compose -f docker-compose.prod.yml logs -f backend
```

### Health Checks

```bash
# Backend health
curl http://localhost:8010/health

# Frontend health
curl http://localhost:3010/api/health
```

### Automated Monitoring Script

Create `monitor.sh`:

```bash
#!/bin/bash

while true; do
    # Check backend health
    if ! curl -f http://localhost:8010/health > /dev/null 2>&1; then
        echo "Backend is down! Restarting..."
        docker compose -f docker-compose.prod.yml restart backend
    fi

    # Check frontend health
    if ! curl -f http://localhost:3010 > /dev/null 2>&1; then
        echo "Frontend is down! Restarting..."
        docker compose -f docker-compose.prod.yml restart frontend
    fi

    sleep 60
done
```

## Updating Application

```bash
# Pull latest code
git pull origin main

# Rebuild and restart services
docker compose -f docker-compose.prod.yml up --build -d

# Verify deployment
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

## Rollback Procedure

```bash
# Stop current deployment
docker compose -f docker-compose.prod.yml down

# Revert to previous version
git checkout <previous-commit-hash>

# Rebuild and start
docker compose -f docker-compose.prod.yml up --build -d
```

## Troubleshooting

### Services Won't Start

```bash
# Check Docker daemon
sudo systemctl status docker

# Check logs
docker compose -f docker-compose.prod.yml logs

# Check ports
sudo netstat -tlnp | grep -E '8010|3010'
```

### High Memory Usage

```bash
# Check container resources
docker stats

# Restart specific service
docker compose -f docker-compose.prod.yml restart backend

# Adjust resource limits in docker-compose.prod.yml
```

### BigQuery Connection Issues

```bash
# Verify credentials
docker compose -f docker-compose.prod.yml exec backend cat /app/gcp-service-account.json

# Test BigQuery connection
docker compose -f docker-compose.prod.yml exec backend python -c "
from google.cloud import bigquery
client = bigquery.Client()
print('Connected successfully!')
"
```

## Scaling

### Horizontal Scaling (Multiple Instances)

```yaml
# docker-compose.prod.yml
services:
  backend:
    deploy:
      replicas: 3

  frontend:
    deploy:
      replicas: 2
```

### Load Balancer Setup

Use Nginx or HAProxy to distribute traffic across multiple containers.

## Backup and Disaster Recovery

### Automated Backup Script

```bash
#!/bin/bash
BACKUP_DIR="/backups/ipat"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup environment
cp .env "$BACKUP_DIR/env_$DATE.backup"

# Backup credentials
cp backend/gcp-service-account.json "$BACKUP_DIR/gcp_creds_$DATE.json"

# Encrypt backups
gpg --encrypt --recipient your@email.com "$BACKUP_DIR/env_$DATE.backup"
gpg --encrypt --recipient your@email.com "$BACKUP_DIR/gcp_creds_$DATE.json"

# Remove unencrypted versions
rm "$BACKUP_DIR/env_$DATE.backup"
rm "$BACKUP_DIR/gcp_creds_$DATE.json"
```

## Cost Optimization

### BigQuery

- Use partitioned tables for large datasets
- Set query timeouts
- Monitor query costs
- Archive old data
- Use query caching

### Docker

- Use multi-stage builds (already implemented)
- Clean unused images: `docker system prune`
- Monitor resource usage
- Scale down when not in use

## Support

For production issues:
1. Check logs: `docker compose logs -f`
2. Verify configuration
3. Check BigQuery quotas
4. Review monitoring dashboards
5. Contact support team

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)
- [Google Cloud BigQuery](https://cloud.google.com/bigquery/docs)
