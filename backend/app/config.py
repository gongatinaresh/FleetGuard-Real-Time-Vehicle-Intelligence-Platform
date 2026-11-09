import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import URL, make_url

BASE_DIR = Path(__file__).resolve().parents[1]

load_dotenv(BASE_DIR / ".env", override=False)

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    database_url = make_url(DATABASE_URL)
    postgres_scheme = database_url.drivername.split("+", maxsplit=1)[0]
    if postgres_scheme in {"postgres", "postgresql"} and database_url.drivername != "postgresql+psycopg":
        DATABASE_URL = database_url.set(drivername="postgresql+psycopg").render_as_string(hide_password=False)
if not DATABASE_URL and os.getenv("POSTGRES_HOST"):
    DATABASE_URL = URL.create(
        "postgresql+psycopg",
        username=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", ""),
        host=os.environ["POSTGRES_HOST"],
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        database=os.getenv("POSTGRES_DB", "vehicle_geofence"),
    ).render_as_string(hide_password=False)
if not DATABASE_URL:
    DATABASE_URL = f"sqlite:///{BASE_DIR / 'app.db'}"

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
