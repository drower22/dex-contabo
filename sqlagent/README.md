# Dex SQL Agent (Microservice)

FastAPI microservice to generate and validate SQL with guardrails and multi-tenant support.

## Run

```bash
export SQLAGENT_API_KEY=dev_key
uvicorn sqlagent.main:app --host 0.0.0.0 --port 8100 --reload
```

## Endpoints
- GET /health
- GET /v1/sql/schemas
- POST /v1/sql/generate
- POST /v1/sql/validate

All protected endpoints require header `x-api-key: <SQLAGENT_API_KEY>` and tenant header `x-account-id: <uuid>`.
