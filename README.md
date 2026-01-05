# IPAT Segmentation Analysis Application

A web application for analyzing pavement distress data. Upload Excel files, segment routes, and visualize IRI (International Roughness Index) trends over time.

---

## What Does This App Do?

1. **Upload** Excel files containing pavement distress measurements
2. **Segment** routes into equal parts for analysis
3. **Compare** IRI values across multiple years
4. **Visualize** results on an interactive map and charts

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11 |
| Database | Google Cloud BigQuery |
| Deployment | Docker, Terraform |

---

## Prerequisites

Before you start, make sure you have:

- [ ] **Docker** installed ([Get Docker](https://docs.docker.com/get-docker/))
- [ ] **GCP Service Account** with BigQuery access
- [ ] Service account JSON file

---

## Getting Started

### Step 1: Clone and Navigate

```bash
cd /path/to/APP
```

### Step 2: Set Up Environment

```bash
# Copy the example environment file
cp .env.example .env
```

Edit `.env` with your GCP details:
```env
GCP_PROJECT_ID=your-project-id
GCP_DATASET_ID=ipat_dataset
```

### Step 3: Add GCP Credentials

Place your service account JSON file here:
```bash
cp /path/to/your-credentials.json backend/gcp-service-account.json
```

### Step 4: Start the Application

You have **three options** to start the app:

#### Option A: Interactive Start Script (Recommended for beginners)
```bash
./start.sh
```
This opens an interactive menu where you can:
- Start/stop services
- View logs
- Check status
- And more...

**Tip:** Press `Ctrl+C` to exit log view, then `Enter` to return to menu.

#### Option B: Make Commands (Quick and easy)
```bash
make dev      # Start in development mode
make down     # Stop all services
make logs     # View logs
make help     # See all commands
```

#### Option C: Docker Compose Directly
```bash
docker compose up --build -d    # Start
docker compose down             # Stop
docker compose logs -f          # View logs
```

---

## Access the Application

Once running, open your browser:

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:3010 |
| **Backend API** | http://localhost:8010 |
| **API Documentation** | http://localhost:8010/docs |

---

## How to Use

### 1. Prepare Your Data

Your Excel files must:
- Have the **year in the filename** (e.g., `2020.xlsx`, `data_2021.xlsx`)
- Include these columns:
  - `ROUTE_NAME`, `FROM_MEASURE`, `TO_MEASURE`
  - `BEGIN_GLAT`, `BEGIN_GLON`, `END_GLAT`, `END_GLON`
  - `IRI`, `COUNTY_ID`, `SURFTYPE`, `FCLASS`, `WIDTH`

### 2. Upload Files

1. Go to http://localhost:3010
2. Click **"Select Excel Files"**
3. Choose 2+ years of data files
4. Click **"Upload Files"**

### 3. Run Analysis

1. Set number of segments (1-100)
2. Click **"Run Segmentation"**
3. View results in the table and map

---

## Common Commands

### Using Make (Shortcut Commands)

| Command | What it does |
|---------|--------------|
| `make dev` | Start development environment |
| `make prod` | Start production environment |
| `make down` | Stop all services |
| `make logs` | View live logs |
| `make logs-backend` | View backend logs only |
| `make logs-frontend` | View frontend logs only |
| `make status` | Show container status |
| `make clean` | Remove containers and volumes |
| `make help` | Show all available commands |

### Using Docker Compose

| Command | What it does |
|---------|--------------|
| `docker compose ps` | Show running containers |
| `docker compose logs -f` | Stream all logs |
| `docker compose logs -f backend` | Stream backend logs |
| `docker compose restart` | Restart all services |
| `docker compose down` | Stop everything |
| `docker compose down -v` | Stop and remove volumes |

---

## Project Structure

```
APP/
├── backend/                 # Python FastAPI server
│   ├── main.py             # API endpoints
│   ├── requirements.txt    # Python dependencies
│   ├── Dockerfile          # Backend container config
│   └── gcp-service-account.json  # Your GCP credentials
│
├── frontend/               # Next.js React app
│   ├── app/               # Pages
│   ├── components/        # UI components
│   ├── Dockerfile         # Frontend container config
│   └── package.json       # Node dependencies
│
├── terraform/             # Infrastructure as Code
│
├── docker-compose.yml     # Development setup
├── docker-compose.prod.yml # Production setup
├── Makefile               # Shortcut commands
├── start.sh               # Interactive start script
├── .env.example           # Environment template
└── README.md              # You are here!
```

---

## Environment Variables

Create a `.env` file with these settings:

### Required
```env
GCP_PROJECT_ID=your-gcp-project-id
GCP_DATASET_ID=ipat_dataset
GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-service-account.json
```

### Optional
```env
BACKEND_PORT=8010          # Default: 8010
FRONTEND_PORT=3010         # Default: 3010
LOG_LEVEL=info             # Options: debug, info, warning, error
NODE_ENV=development       # Options: development, production
```

---

## Troubleshooting

### "Container is unhealthy"

Check the logs:
```bash
docker logs ipat-backend
docker logs ipat-frontend
```

### "Cannot connect to localhost:3010"

1. Check if containers are running:
   ```bash
   docker compose ps
   ```

2. If frontend is restarting, check logs:
   ```bash
   docker logs ipat-frontend
   ```

### "BigQuery connection failed"

1. Verify credentials file exists:
   ```bash
   ls -la backend/gcp-service-account.json
   ```

2. Check GCP project ID in `.env`

### "Port already in use"

Find what's using the port:
```bash
lsof -i :8010  # Backend port
lsof -i :3010  # Frontend port
```

Then either stop that process or change ports in `.env`.

---

## Development vs Production

| Aspect | Development (`docker-compose.yml`) | Production (`docker-compose.prod.yml`) |
|--------|-----------------------------------|----------------------------------------|
| Hot reload | ✅ Yes | ❌ No |
| Code mounting | ✅ Local files mounted | ❌ Built into image |
| Logging | Verbose (info) | Minimal (warning) |
| Performance | Slower | Optimized |

**Start production:**
```bash
docker compose -f docker-compose.prod.yml up --build -d
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Check BigQuery connection |
| POST | `/upload` | Upload Excel files |
| POST | `/process?num_segments=20` | Run segmentation |
| GET | `/results?limit=1000` | Get results |
| GET | `/tables` | List uploaded tables |
| DELETE | `/clear` | Clear all data |

Full API docs: http://localhost:8010/docs

---

## Additional Documentation

- [QUICKSTART.md](QUICKSTART.md) - 5-minute setup guide
- [DEPLOYMENT.md](DEPLOYMENT.md) - Cloud deployment options
- [terraform/README.md](terraform/README.md) - Infrastructure setup
- [OVERLAPPING_SEGMENT_LOGIC.md](OVERLAPPING_SEGMENT_LOGIC.md) - Algorithm details

---

## Need Help?

1. Check the logs: `make logs` or `docker compose logs -f`
2. Review the troubleshooting section above
3. Check BigQuery console for data issues
4. Open an issue on the repository

---

## License

MIT
