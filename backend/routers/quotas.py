from fastapi import APIRouter, Header
from typing import Optional
import asyncio
import httpx
from routers.subscriptions import _extract, _raise, _hdrs

router = APIRouter()
ARM    = "https://management.azure.com"
CS_VER = "2023-05-01"


@router.get("/quotas")
async def get_quotas(authorization: Optional[str] = Header(None)):
    """
    Returns provisioned quota (TPM / RPM) for every deployment across all
    Foundry / OpenAI / AIServices resources the caller can see.
    """
    token = _extract(authorization)

    # 1. Discover all Cognitive Services accounts via Resource Graph
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{ARM}/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01",
            headers=_hdrs(token),
            json={
                "query": (
                    "resources "
                    "| where type == 'microsoft.cognitiveservices/accounts' "
                    "| where kind in ('AIServices', 'OpenAI', 'CognitiveServices') "
                    "| project name, rg=resourceGroup, subId=subscriptionId, "
                    "  location, kind"
                ),
                "options": {"$top": 1000},
            },
        )
        _raise(r)
        resources = r.json().get("data", [])

    # 2. Fetch subscription display names
    async with httpx.AsyncClient(timeout=15) as c:
        sr = await c.get(
            f"{ARM}/subscriptions?api-version=2022-12-01",
            headers=_hdrs(token),
        )
    sub_names = {}
    if sr.is_success:
        sub_names = {
            s["subscriptionId"]: s["displayName"]
            for s in sr.json().get("value", [])
        }

    # 3. For each resource, list deployments (with full SKU / model / rateLimits)
    async def _fetch(res: dict) -> list[dict]:
        sub_id = res["subId"]
        rg_name = res["rg"]
        name = res["name"]
        location = res.get("location", "")
        kind = res.get("kind", "")
        url: str | None = (
            f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg_name}"
            f"/providers/Microsoft.CognitiveServices/accounts/{name}"
            f"/deployments?api-version={CS_VER}"
        )
        rows: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                while url:
                    r = await c.get(url, headers={"Authorization": f"Bearer {token}"})
                    if not r.is_success:
                        break
                    body = r.json()
                    for d in body.get("value", []):
                        props = d.get("properties", {})
                        model = props.get("model", {})
                        sku = d.get("sku", {})
                        rate_limits = props.get("rateLimits", [])

                        tpm = sku.get("capacity", 0)
                        rpm = 0
                        for rl in rate_limits:
                            key = (rl.get("key") or "").lower()
                            if key == "request":
                                rpm = rl.get("count", 0)
                            elif key == "token" and tpm == 0:
                                tpm = rl.get("count", 0)

                        rows.append({
                            "resource": name,
                            "rg": rg_name,
                            "subId": sub_id,
                            "subName": sub_names.get(sub_id, sub_id),
                            "location": location,
                            "kind": kind,
                            "deployment": d.get("name", ""),
                            "model": model.get("name", ""),
                            "modelVersion": model.get("version", ""),
                            "modelFormat": model.get("format", ""),
                            "skuName": sku.get("name", ""),
                            "skuTier": sku.get("tier", ""),
                            "tpm": tpm,
                            "rpm": rpm,
                            "provisioningState": props.get("provisioningState", ""),
                            "versionUpgrade": props.get("versionUpgradeOption", ""),
                        })
                    url = body.get("nextLink")
        except Exception:
            pass
        return rows

    results = await asyncio.gather(*[_fetch(r) for r in resources])
    # flatten
    all_rows = [row for batch in results for row in batch]
    return sorted(all_rows, key=lambda x: (x["subName"], x["resource"], x["deployment"]))
