# IPAT Segmentation Analysis Application

A full-stack application for processing and analyzing pavement distress data with dynamic segmentation using Google Cloud BigQuery.

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: FastAPI, Python 3.11
- **Database**: Google Cloud BigQuery
- **Infrastructure**: Terraform, Docker
- **Cloud Platform**: Google Cloud Platform (GCP)

## Key Features

- Upload multiple Excel files with distress data
- Dynamic year detection from filenames
- Configurable number of segments (1-100 per route)
- Automated route analysis with 2+ consecutive years requirement
- Interactive results table with dynamic IRI columns
- REST API for data processing
- Infrastructure as Code with Terraform

## Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+ (recommended)
- OR: Conda/Python 3.11 and Node.js 18+ (for local development)
- GCP account with BigQuery API enabled
- GCP service account credentials

## Quick Start with Docker

### 1. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your GCP project details
nano .env
```

### 2. Add GCP Credentials

Place your service account JSON file in the backend directory:

```bash
cp /path/to/your/service-account.json backend/gcp-service-account.json
```

### 3. Start Application

```bash
# Development mode with hot-reload
docker-compose up --build

# Or run in background
docker-compose up --build -d

# View logs
docker-compose logs -f
```

Access the application:
- **Frontend**: http://localhost:3010
- **Backend API**: http://localhost:8010
- **API Docs**: http://localhost:8010/docs

### 4. Stop Application

```bash
docker-compose down
```

## Local Development (Without Docker)

### Backend Setup

```bash
# Activate conda environment
conda activate ipat

# Install dependencies
cd backend
pip install -r requirements.txt

# Configure .env file
cp .env.example .env
# Edit .env with your GCP project details

# Start backend
python main.py
```

Backend runs on http://localhost:8010

### Frontend Setup

```bash
# Install dependencies
cd frontend
npm install

# Start frontend
npm run dev
```

Frontend runs on http://localhost:3010

## Usage

### 1. Prepare Data Files

Excel files must:
- Contain the year in filename (e.g., `2020.xlsx`, `distress_2021.xlsx`)
- Include required columns: ROUTE_NAME, FROM_MEASURE, TO_MEASURE, BEGIN_GLAT, BEGIN_GLON, END_GLAT, END_GLON, IRI, COUNTY_ID, SURFTYPE, FCLASS, WIDTH

### 2. Upload Files

1. Navigate to http://localhost:3010
2. Click "Select Excel Files"
3. Choose your data files (2+ years required)
4. Click "Upload Files"

### 3. Process Data

1. Select number of segments (1-100, default: 20)
2. Click "Run Segmentation"
3. View results in the interactive table

## API Endpoints

- `GET /health` - BigQuery connection status
- `POST /upload` - Upload Excel files
- `POST /process?num_segments=20` - Run segmentation pipeline
- `GET /results?limit=1000&offset=0` - Get paginated results
- `GET /tables` - List uploaded tables
- `DELETE /clear` - Clear all data tables

See full API documentation at http://localhost:8010/docs

## Project Structure

```
APP/
├── backend/
│   ├── main.py                    # FastAPI app
│   ├── requirements.txt           # Python dependencies
│   ├── Dockerfile                 # Backend container
│   ├── gcp-service-account.json   # GCP credentials (not in git)
│   └── .env                       # Environment config
├── frontend/
│   ├── app/                       # Next.js pages
│   ├── components/                # React components
│   ├── Dockerfile                 # Frontend container
│   └── package.json               # Node dependencies
├── terraform/                     # Infrastructure as Code
│   ├── main.tf
│   ├── variables.tf
│   └── README.md
├── docker-compose.yml             # Development setup
├── docker-compose.prod.yml        # Production setup
├── .env.example                   # Environment template
├── Makefile                       # Common commands
└── README.md
```

## Infrastructure as Code

Deploy BigQuery dataset and configure permissions with Terraform:

```bash
cd terraform
terraform init
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your settings
terraform plan
terraform apply
```

See `terraform/README.md` for detailed instructions.

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
| `LOG_LEVEL` | `INFO` | Logging level |
| `NODE_ENV` | `development` | Node environment |

## Docker Commands

```bash
# View running containers
docker-compose ps

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart service
docker-compose restart backend

# Access container shell
docker-compose exec backend bash
docker-compose exec frontend sh

# Stop and remove containers
docker-compose down

# Rebuild without cache
docker-compose build --no-cache
```

## Troubleshooting

### BigQuery Connection Error

```bash
# Verify credentials exist
cat backend/gcp-service-account.json

# Check environment variables
docker-compose exec backend env | grep GCP

# Test connection
docker-compose exec backend python -c "from google.cloud import bigquery; client = bigquery.Client(); print('Connected!')"
```

### Port Already in Use

```bash
# Check what's using the port
lsof -i :8010  # Backend
lsof -i :3010  # Frontend

# Change ports in .env file
```

### Upload or Processing Fails

- Ensure files have year in filename
- Verify all required columns are present
- Check at least 2 years of data exist
- View BigQuery logs in GCP Console

## Production Deployment

For production deployment:

```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up --build -d

# Or deploy to Cloud Run (see DEPLOYMENT.md)
```

Security checklist:
- Use production GCP credentials with minimal permissions
- Set `NODE_ENV=production`
- Update `CORS_ORIGINS` to production domain
- Use HTTPS for all endpoints
- Implement rate limiting
- Set up monitoring and alerts

See `README.Docker.md` and `DEPLOYMENT.md` for detailed production setup.

## Cost Optimization

BigQuery pricing:
- Storage: $0.02/GB/month (first 10GB free)
- Queries: $5/TB processed (first 1TB/month free)
- Light usage (< 10GB, < 1TB queries): FREE
- Medium usage (50GB, 5TB queries): ~$20-30/month

Tips:
- Use `LIMIT` in queries
- Clean up intermediate tables regularly
- Use table expiration policies

## Additional Documentation

- `QUICKSTART.md` - Quick setup guide
- `README.Docker.md` - Detailed Docker deployment guide
- `DEPLOYMENT.md` - Production deployment options
- `OVERLAPPING_SEGMENT_LOGIC.md` - Segmentation algorithm details
- `terraform/README.md` - Infrastructure management

## License

MIT

## Support

For issues or questions:
- Review documentation files
- Check application logs
- Review BigQuery console for data issues
- Open issue on repository
