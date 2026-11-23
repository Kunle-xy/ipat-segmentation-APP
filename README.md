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
| Database | PostgreSQL 16 for local development, BigQuery for production |
| Deployment | Docker, Terraform |

---

## Local Development with PostgreSQL

Install Docker with the Compose plugin and make sure your user can run `docker info`. From the repository root, run:

```bash
./start.sh start
```

The script creates `.env` from `.env.example` if needed. You can also use `make dev` or `docker compose up --build -d`. The default settings work without a GCP project, a key file, or Cloud Storage access. Docker needs registry access for the initial image build.

Compose starts PostgreSQL 16 on its internal network, starts FastAPI after the database is ready, and starts Next.js after the API health check passes. The backend receives an internal `DATABASE_URL`. Next.js sends files to the API as multipart requests, and the API saves them in PostgreSQL. Each county gets an `ipat_<county>` schema, and re-uploading a file for a year replaces that year's raw table. Processing runs the segmentation query in PostgreSQL and saves the results and metadata for the browser.

| Service | Default URL |
|---------|-------------|
| Frontend | http://localhost:3010 |
| Backend API | http://localhost:8010 |
| API documentation | http://localhost:8010/docs |

Both app containers mount the source for live reload. To change the host ports, edit `FRONTEND_PORT` and `BACKEND_PORT` in `.env`. Set `CORS_ORIGINS` to include the browser's frontend origin and `NEXT_PUBLIC_API_URL` to the browser-reachable API URL. If your existing `.env` came from a production setup, check these values before starting locally.

```bash
docker compose ps
docker compose logs -f backend postgres
docker compose down
```

The `postgres-data` volume keeps local uploads and results across restarts and `docker compose down`. To reset local data completely, run `docker compose down -v`. Local PostgreSQL starts empty. To develop with a representative county, upload its source files for at least two years.

### PostgreSQL integration tests

With the backend Python dependencies installed, point the API integration tests at a disposable PostgreSQL database:

```bash
IPAT_TEST_DATABASE_URL='postgresql://user:password@localhost:5432/ipat_test' \
  python -m pytest backend/tests/test_postgres_integration.py
```

The tests create and clear temporary county schemas. They exercise CSV and Excel upload, both segmentation modes, and result retrieval.

## Production with BigQuery

Production still uses BigQuery for ingestion, segmentation, and results. The browser uses signed Cloud Storage upload URLs, then asks the API to ingest the staged files. Use a GCP project with BigQuery enabled and configure the upload bucket with the permissions and browser CORS rules required by that flow.

### Single Docker host

Copy `.env.example` to `.env` if needed. Set these values for your deployment:

- `GCP_PROJECT_ID` selects the GCP project. The backend creates and uses county-specific BigQuery datasets in that project.
- `GOOGLE_APPLICATION_CREDENTIALS` points to the mounted key at `/app/gcp-service-account.json`. Place the key at `backend/gcp-service-account.json` on the host and make it readable by the backend container.
- `GCS_UPLOAD_BUCKET` selects the upload bucket. The default is `ipat-uploads-<project-id>`.
- `NEXT_PUBLIC_API_URL` points to the public API URL. Next.js embeds it at build time, so rebuild the frontend if the URL changes.
- `CORS_ORIGINS` lists the frontend origins that may call the API.

Stop the local stack before starting production on the same host ports. Then run:

```bash
./start.sh start-prod
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

Use `make prod-down` to stop it. Compose builds standalone Next.js and multi-worker FastAPI images. To deploy source changes, rebuild and recreate the services with `make prod`. See [DEPLOYMENT.md](DEPLOYMENT.md) for reverse proxy and HTTPS setup.

### Google Cloud Run

Use the deployment targets in the [Makefile](Makefile) from a machine authenticated to GCP with `gcloud` and Docker. Configure `GCP_PROJECT`, `GCP_REGION`, and the Artifact Registry repository for your environment. The Cloud Run backend identity needs permission to run BigQuery jobs and manage the app's datasets, access staged objects in the upload bucket, and sign upload URLs through IAM.

`make deploy` configures Artifact Registry, builds and pushes the production images, deploys the backend, rebuilds and deploys the frontend with the backend URL, and updates backend CORS. These targets send traffic to the latest service revisions. Check service URLs and revision status with `make deploy-status`. Terraform definitions for the GCP infrastructure are under [terraform/](terraform/).

## Data Requirements

These requirements apply to both local and production uploads.

- Use **Excel (`.xlsx`) or CSV (`.csv`)** with the column names in the first row. Save legacy `.xls` files as `.xlsx` before uploading.
- Prepare one file per county per year and select the county when uploading. Put the four-digit year in each filename, such as `distress_2020.xlsx` or `distress_2021.csv`. Keep other digits out of the filename because the uploader joins all filename digits to read the year.
- Upload data for **at least two years** for the same county. Use consistent route identifiers and mileposts across years. A segment needs overlapping route coverage and usable IRI data in every selected year to appear in the results.

### Required columns

| Column | What to provide |
|---------|-----------------|
| `ROUTE_NAME` | Road name or code, such as `US-30`. |
| `FROM_MEASURE`, `TO_MEASURE` | Numeric start and end mileposts in miles. Use a positive-length interval. |
| `BEGIN_GLAT`, `BEGIN_GLON` | Numeric start latitude and longitude in decimal degrees. |
| `END_GLAT`, `END_GLON` | Numeric end latitude and longitude in decimal degrees. |
| `IRI` | Numeric International Roughness Index. Use consistent units across years. For Excel and direct API uploads, the backend can derive IRI when both `LIRI` and `RIRI` columns are present. The browser's CSV validator requires the `IRI` header. |
| `COUNTY_ID` | Numeric county identifier from the source data. |
| `SURFTYPE` | Surface type code or label, such as `AC` or `PCC`. |

Include a stable **`ROUTE_ID`** such as `M141541470N` in every year file when available. The browser requires this column for CSV uploads. The segmentation engine matches on `ROUTE_ID` when every selected file contains the column. Otherwise, it matches on `ROUTE_NAME`. `FCLASS` and `WIDTH` are optional.

Example row for `distress_2020.csv`:

```csv
ROUTE_ID,ROUTE_NAME,FROM_MEASURE,TO_MEASURE,BEGIN_GLAT,BEGIN_GLON,END_GLAT,END_GLON,IRI,COUNTY_ID,SURFTYPE
M141541470N,US-30,10.00,10.10,41.5000,-93.5000,41.5010,-93.4990,85.0,77,AC
```

## How to Use

### 1. Upload Files

1. Go to http://localhost:3010
2. Select the county and open the file picker
3. Choose files for at least two years
4. Click **"Upload Files"**

### 2. Run Analysis

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
│   └── postgres.py         # Local PostgreSQL storage
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

## Troubleshooting

- If Docker reports a socket permission error, check that your user has access to the daemon.
- If local containers are unhealthy, run `docker compose ps` and `docker compose logs backend postgres`.
- If the browser cannot reach the API, check the API URL, host port, and CORS origin in `.env`.
- If production cannot reach BigQuery, check the project and runtime identity. Inspect the `/health` response body for BigQuery connection errors.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Check the configured database connection |
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
