"""Database initialisation — creates tables on first import."""

import sqlite3
from pathlib import Path

SCHEMA_SQL = Path(__file__).parent / "schema.sql"


def get_connection(db_path: str = "woxus_memory.db") -> sqlite3.Connection:
    """Open a connection to the memory database and ensure tables exist."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _init_tables(conn)
    return conn


def _init_tables(conn: sqlite3.Connection) -> None:
    """Create tables if they don't exist."""
    if SCHEMA_SQL.exists():
        conn.executescript(SCHEMA_SQL.read_text())
