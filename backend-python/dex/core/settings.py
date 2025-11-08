from pydantic_settings import BaseSettings
from functools import lru_cache
import os
from dotenv import load_dotenv

# Ensure env vars are loaded whether app starts from project root or backend/
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))  # points to backend/
_ROOT_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, ".."))

# Load root .env (if exists)
load_dotenv(os.path.join(_ROOT_DIR, ".env"), override=False)
# Load backend/.env (if exists)
load_dotenv(os.path.join(_BACKEND_DIR, ".env"), override=False)


class Settings(BaseSettings):
    # Supabase
    SUPABASE_URL: str
    SUPABASE_KEY: str

    # WhatsApp Cloud API (para fases futuras)
    WA_PERMANENT_TOKEN: str | None = None
    WA_PHONE_NUMBER_ID: str | None = None
    WA_API_BASE: str | None = "https://graph.facebook.com/v19.0"

    class Config:
        case_sensitive = True
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()  # type: ignore[arg-type]
