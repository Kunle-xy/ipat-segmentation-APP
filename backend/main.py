import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_bigquery_client, PROJECT_ID
from routes.upload import router as upload_router
from routes.process import router as process_router
from routes.results import router as results_router
from routes.counties import router as counties_router

app = FastAPI(title="IPAT Segmentation Analysis API")

# CORS middleware - allow Cloud Run and localhost
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3010").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(upload_router)
app.include_router(process_router)
app.include_router(results_router)
app.include_router(counties_router)


@app.get("/")
def read_root():
    return {"message": "IPAT Segmentation Analysis API (BigQuery)", "status": "running"}


@app.get("/health")
def health_check():
    try:
        query = "SELECT 1"
        get_bigquery_client().query(query).result()
        return {"result": "OK", "status": "healthy", "bigquery": "connected", "project": PROJECT_ID}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8010)
