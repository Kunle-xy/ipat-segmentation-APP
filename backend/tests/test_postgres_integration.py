"""Run against a disposable PostgreSQL database using IPAT_TEST_DATABASE_URL."""

from io import BytesIO
import os
from uuid import uuid4

from fastapi.testclient import TestClient
import pandas as pd
import pytest

import postgres
from main import app


@pytest.mark.parametrize("segmentation_type", ["fixed", "distance"])
def test_local_county_workflow(monkeypatch, segmentation_type):
    database_url = os.getenv("IPAT_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Set IPAT_TEST_DATABASE_URL to a disposable PostgreSQL database")
    monkeypatch.setattr(postgres, "DATABASE_URL", database_url)

    def unexpected_cloud_call(*args, **kwargs):
        pytest.fail("Local requests must not access GCP")

    monkeypatch.setattr("main.get_bigquery_client", unexpected_cloud_call)
    monkeypatch.setattr("routes.process.get_bigquery_client", unexpected_cloud_call)
    monkeypatch.setattr("routes.results.get_bigquery_client", unexpected_cloud_call)
    monkeypatch.setattr("routes.counties.get_bigquery_client", unexpected_cloud_call)
    monkeypatch.setattr("routes.upload.ensure_dataset_exists", unexpected_cloud_call)

    county = f"test_{uuid4().hex}"
    params = {"county_name": county}

    with TestClient(app) as api:
        try:
            assert api.get("/health").json()["postgres"] == "connected"
            assert api.post("/upload-url", params=params).status_code == 404

            csv = (
                "ROUTE_ID,ROUTE_NAME,FROM_MEASURE,TO_MEASURE,BEGIN_GLAT,BEGIN_GLON,"
                "END_GLAT,END_GLON,IRI,COUNTY_ID,SURFTYPE\n"
                "M123,Main,0,1,41,-93,42,-94,80,77,AC\n"
            )
            workbook = BytesIO()
            frame = pd.read_csv(BytesIO(csv.encode())).drop(columns=["IRI"])
            frame["LIRI"] = 90
            frame["RIRI"] = 110
            frame["Extra column"] = "ignored by segmentation"
            frame.to_excel(workbook, index=False)

            for filename, content in [("2020.csv", csv), ("2021.xlsx", workbook.getvalue())]:
                upload = api.post("/upload", params=params, files={"files": (filename, content)})
                assert upload.status_code == 200, upload.text
                assert upload.json()["tables"][0]["rows"] == 1

            assert county in api.get("/counties").json()["counties"]
            assert [table["table_name"] for table in api.get("/tables", params=params).json()["tables"]] == [
                "raw_distress_2020", "raw_distress_2021",
            ]

            processed = api.post("/process", params={**params, "segmentation_type": segmentation_type})
            assert processed.status_code == 200, processed.text
            assert processed.json()["segments_created"] == 1
            assert processed.json()["routes_processed"] == 1

            results = api.get("/results", params={**params, "selected_years": "2020,2021"})
            assert results.status_code == 200, results.text
            payload = results.json()
            assert payload["total"] == 1
            assert payload["metadata"]["segmentation_type"] == segmentation_type
            row = payload["data"][0]
            assert row["ROUTE_ID"] == "M123"
            assert row["ROUTE_NAME"] == "Main"
            assert row["segment_id"] == 1
            assert row["length_ft"] == 5280
            assert row["iri_2020"] == 80
            assert row["iri_2021"] == 100
            assert row["liri_2020"] is None
            assert row["liri_2021"] == 90
            assert row["riri_2021"] == 110
            assert (row["from_lat"], row["to_lon"]) == (41, -94)
        finally:
            assert api.delete("/clear", params=params).status_code == 200

        assert api.get("/results", params=params).status_code == 404
        assert county not in api.get("/counties").json()["counties"]
