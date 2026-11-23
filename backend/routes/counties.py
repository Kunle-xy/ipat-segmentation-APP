from fastapi import APIRouter, HTTPException
import re
import logging

import postgres

from config import PROJECT_ID, get_bigquery_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _county_schema(county_name):
    return "ipat_" + re.sub(r"[^a-z0-9_]", "_", county_name.lower().strip())


@router.get("/counties")
def list_counties():
    """
    List all counties that have datasets (ipat_* datasets).
    """
    try:
        if postgres.DATABASE_URL:
            with postgres.connect() as connection:
                counties = [schema.removeprefix("ipat_") for schema in postgres.schemas(connection)]
            return {"status": "success", "count": len(counties), "counties": counties}

        datasets = list(get_bigquery_client().list_datasets())
        counties = []

        for dataset in datasets:
            ds_id = dataset.dataset_id
            if ds_id.startswith('ipat_') and ds_id != 'ipat_dataset':
                county = ds_id.replace('ipat_', '')
                counties.append(county)

        return {
            "status": "success",
            "count": len(counties),
            "counties": sorted(counties)
        }

    except Exception as e:
        logger.error(f"List counties error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tables")
def list_tables(county_name: str = None):
    """
    List all tables in BigQuery.
    If county_name is provided, list tables in that county's dataset.

    Args:
        county_name: Optional county name to filter tables
    """
    try:
        if postgres.DATABASE_URL:
            with postgres.connect() as connection:
                schemas = [_county_schema(county_name)] if county_name else postgres.schemas(connection)
                tables = [
                    {"table_name": row["table_name"], "dataset": schema, "county": schema.removeprefix("ipat_")}
                    for schema in schemas
                    for row in postgres.tables(connection, schema)
                ]
            return {"status": "success", "count": len(tables), "county_filter": county_name, "tables": tables}

        client = get_bigquery_client()

        if county_name:
            county = re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())
            county_dataset = f"ipat_{county}"

            query = f"""
            SELECT table_name
            FROM `{PROJECT_ID}.{county_dataset}.INFORMATION_SCHEMA.TABLES`
            ORDER BY table_name
            """

            result = client.query(query).result()
            tables = [
                {
                    "table_name": row.table_name,
                    "dataset": county_dataset,
                    "county": county
                }
                for row in result
            ]
        else:
            # List all ipat_ datasets and their tables
            datasets = list(client.list_datasets())
            tables = []

            for dataset in datasets:
                ds_id = dataset.dataset_id
                if ds_id.startswith('ipat_'):
                    try:
                        query = f"""
                        SELECT table_name
                        FROM `{PROJECT_ID}.{ds_id}.INFORMATION_SCHEMA.TABLES`
                        ORDER BY table_name
                        """
                        result = client.query(query).result()
                        for row in result:
                            tables.append({
                                "table_name": row.table_name,
                                "dataset": ds_id,
                                "county": ds_id.replace('ipat_', '') if ds_id != 'ipat_dataset' else None
                            })
                    except:
                        pass

        return {
            "status": "success",
            "count": len(tables),
            "county_filter": county_name,
            "tables": tables
        }

    except Exception as e:
        logger.error(f"List tables error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clear")
def clear_data(county_name: str = None):
    """
    Clear data for a county (deletes the entire dataset).
    If county_name is provided, only clear that county's dataset.
    Otherwise, clear all ipat_* datasets.

    Args:
        county_name: Optional county name to filter deletion
    """
    try:
        if postgres.DATABASE_URL:
            with postgres.connect() as connection:
                targets = [_county_schema(county_name)] if county_name else postgres.schemas(connection)
                deleted = []
                for schema in targets:
                    postgres.lock_county(connection, schema)
                    if schema in postgres.schemas(connection):
                        connection.execute(f"DROP SCHEMA {postgres.identifier(schema)} CASCADE")
                        deleted.append(schema)
            return {
                "status": "success",
                "message": f"Cleared {len(deleted)} dataset(s)",
                "county": county_name,
                "deleted_datasets": deleted,
            }

        client = get_bigquery_client()
        deleted_datasets = []

        if county_name:
            county = re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())
            county_dataset = f"ipat_{county}"

            try:
                client.delete_dataset(f"{PROJECT_ID}.{county_dataset}", delete_contents=True)
                deleted_datasets.append(county_dataset)
                logger.info(f"Deleted dataset: {county_dataset}")
            except Exception as e:
                logger.warning(f"Could not delete dataset {county_dataset}: {e}")

            message = f"Cleared dataset for county {county_name}"
        else:
            # Delete all ipat_ datasets except the default
            datasets = list(client.list_datasets())
            for dataset in datasets:
                ds_id = dataset.dataset_id
                if ds_id.startswith('ipat_') and ds_id != 'ipat_dataset':
                    try:
                        client.delete_dataset(f"{PROJECT_ID}.{ds_id}", delete_contents=True)
                        deleted_datasets.append(ds_id)
                        logger.info(f"Deleted dataset: {ds_id}")
                    except Exception as e:
                        logger.warning(f"Could not delete dataset {ds_id}: {e}")

            message = f"Cleared {len(deleted_datasets)} dataset(s)"

        return {
            "status": "success",
            "message": message,
            "county": county_name,
            "deleted_datasets": deleted_datasets
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Clear error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
