from fastapi import APIRouter
import os

router = APIRouter()


@router.get("/config")
def get_config():
    return {
        "clientId":      os.environ.get("AZURE_CLIENT_ID",   ""),
        "tenantId":      os.environ.get("AZURE_TENANT_ID",   ""),
        "apimName":      os.environ.get("APIM_SERVICE_NAME", os.environ.get("APIM_NAME", "")),
        "apimSubId":     os.environ.get("APIM_SUBSCRIPTION_ID", ""),
        "apimRg":        os.environ.get("APIM_RESOURCE_GROUP",  ""),
        "apimApiId":     os.environ.get("APIM_API_ID",       ""),
        "apimBackendId": os.environ.get("APIM_BACKEND_ID",   ""),
        "defaultTpm":    int(os.environ.get("DEFAULT_TPM",   "10000")),
    }
