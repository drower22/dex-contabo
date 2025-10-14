from functools import lru_cache
from supabase import create_client, Client
from ..core.settings import get_settings


def get_supabase() -> Client:
    settings = get_settings()
    
    # Initialize client with service role key for RLS bypass
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    # Service key via create_client is sufficient for server-side operations.
    return client
