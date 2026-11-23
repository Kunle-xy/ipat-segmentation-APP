"""PostgreSQL storage for the local IPAT stack."""

import re

from fastapi import HTTPException

from config import DATABASE_URL


def connect():
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def identifier(name):
    # PostgreSQL silently truncates identifiers longer than 63 bytes.
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", name):
        raise HTTPException(400, detail=f"Invalid PostgreSQL identifier: {name}")
    return f'"{name}"'


def table_ref(schema, table):
    return f"{identifier(schema)}.{identifier(table)}"


def lock_county(connection, schema):
    connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (schema,))


def schemas(connection):
    rows = connection.execute(
        """SELECT schema_name FROM information_schema.schemata
           WHERE left(schema_name, 5) = 'ipat_' AND schema_name <> 'ipat_dataset'
           ORDER BY schema_name"""
    )
    return [row["schema_name"] for row in rows]


def tables(connection, schema):
    return connection.execute(
        """SELECT table_name FROM information_schema.tables
           WHERE table_schema = %s AND table_type = 'BASE TABLE'
           ORDER BY table_name""",
        (schema,),
    ).fetchall()


def columns(connection, schema):
    return connection.execute(
        """SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = %s ORDER BY ordinal_position""",
        (schema,),
    ).fetchall()


def replace_table(schema, table):
    qualified = table_ref(schema, table)
    return f"DROP TABLE IF EXISTS {qualified}; CREATE TABLE {qualified} AS"


def load_distress(frame, schema, table):
    numeric = {
        "from_measure", "to_measure", "begin_glat", "begin_glon",
        "end_glat", "end_glon", "iri", "liri", "riri", "county_id",
    }
    text = {"route_name", "route_id", "surftype"}
    selected = [column for column in frame.columns if column.lower() in numeric | text]
    frame = frame[selected].astype(object).where(frame[selected].notna(), None)
    fields = [
        f"{identifier(column.lower())} {'double precision' if column.lower() in numeric else 'text'}"
        for column in frame.columns
    ]
    qualified = table_ref(schema, table)
    with connect() as connection, connection.cursor() as cursor:
        lock_county(connection, schema)
        cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {identifier(schema)}")
        cursor.execute(f"DROP TABLE IF EXISTS {qualified}")
        cursor.execute(f"CREATE TABLE {qualified} ({', '.join(fields)})")
        with cursor.copy(f"COPY {qualified} FROM STDIN") as copy:
            for row in frame.itertuples(index=False, name=None):
                copy.write_row(row)
