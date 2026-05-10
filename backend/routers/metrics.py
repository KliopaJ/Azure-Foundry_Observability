from fastapi import APIRouter, Header
from typing import Optional
from collections import defaultdict
import httpx
from routers.subscriptions import _extract, _raise

router = APIRouter()
ARM         = "https://management.azure.com"
MONITOR_VER = "2023-10-01"


@router.get("/metrics")
async def get_metrics(
    sub_id: str, rg: str, foundry: str,
    start: str, end: str,
    granularity: str = "PT1H",
    authorization: Optional[str] = Header(None),
):
    token = _extract(authorization)
    base = (
        f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg}"
        f"/providers/Microsoft.CognitiveServices/accounts/{foundry}"
        f"/providers/microsoft.insights/metrics"
    )
    params = {
        "api-version":     MONITOR_VER,
        "metricnames":     "InputTokens,OutputTokens,TotalTokens,ModelRequests",
        "timespan":        f"{start}/{end}",
        "interval":        granularity,
        "aggregation":     "Total",
        "$filter":         "ModelDeploymentName eq '*'",
        "metricnamespace": "microsoft.cognitiveservices/accounts",
    }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(base, params=params, headers={"Authorization": f"Bearer {token}"})
        _raise(r)

    key_map = {
        "InputTokens":   "inputTokens",
        "OutputTokens":  "outputTokens",
        "TotalTokens":   "totalTokens",
        "ModelRequests": "requests",
    }
    data: dict = defaultdict(lambda: defaultdict(lambda: {
        "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "requests": 0,
    }))

    for metric in r.json().get("value", []):
        key = key_map.get(metric["name"]["value"])
        if not key:
            continue
        for ts in metric.get("timeseries", []):
            dep = next(
                (d["value"] for d in ts.get("metadatavalues", [])
                 if d["name"]["value"] == "modeldeploymentname"),
                "unknown",
            )
            for pt in ts.get("data", []):
                v = int(pt.get("total") or 0)
                if v > 0:
                    data[dep][pt["timeStamp"]][key] += v

    rows = [
        {"deployment": dep, "timestamp": ts, **vals}
        for dep, ts_map in data.items()
        for ts, vals in ts_map.items()
    ]
    return sorted(rows, key=lambda x: (x["deployment"], x["timestamp"]))


# ── GET /api/forecast ─────────────────────────────────────────────────────────
# Queries metrics for each Foundry resource across subscriptions.
# Returns per-resource, per-deployment token/request totals for the given window.
import asyncio
from routers.subscriptions import _hdrs, PROJ_VER

@router.get("/forecast")
async def get_forecast(
    start: str, end: str,
    granularity: str = "P1D",
    authorization: Optional[str] = Header(None),
):
    token = _extract(authorization)

    # 1. Discover all Foundry resources across subscriptions via Resource Graph
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{ARM}/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01",
            headers=_hdrs(token),
            json={
                "query": (
                    "resources "
                    "| where type == 'microsoft.cognitiveservices/accounts' "
                    "| where kind in ('AIServices', 'OpenAI', 'CognitiveServices') "
                    "| project name, rg=resourceGroup, subId=subscriptionId"
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
        sub_names = {s["subscriptionId"]: s["displayName"] for s in sr.json().get("value", [])}

    # 3. Fetch metrics for each resource in parallel
    async def _fetch_resource(res: dict) -> dict:
        sub_id, rg_name, name = res["subId"], res["rg"], res["name"]
        base = (
            f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg_name}"
            f"/providers/Microsoft.CognitiveServices/accounts/{name}"
            f"/providers/microsoft.insights/metrics"
        )
        params = {
            "api-version":     MONITOR_VER,
            "metricnames":     "InputTokens,OutputTokens,TotalTokens,ModelRequests",
            "timespan":        f"{start}/{end}",
            "interval":        granularity,
            "aggregation":     "Total",
            "$filter":         "ModelDeploymentName eq '*'",
            "metricnamespace": "microsoft.cognitiveservices/accounts",
        }
        key_map = {
            "InputTokens":   "inputTokens",
            "OutputTokens":  "outputTokens",
            "TotalTokens":   "totalTokens",
            "ModelRequests": "requests",
        }
        deployments: dict = defaultdict(lambda: {
            "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "requests": 0,
        })
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                mr = await c.get(base, params=params, headers={"Authorization": f"Bearer {token}"})
            if mr.is_success:
                for metric in mr.json().get("value", []):
                    key = key_map.get(metric["name"]["value"])
                    if not key:
                        continue
                    for ts in metric.get("timeseries", []):
                        dep = next(
                            (d["value"] for d in ts.get("metadatavalues", [])
                             if d["name"]["value"] == "modeldeploymentname"),
                            "unknown",
                        )
                        for pt in ts.get("data", []):
                            v = int(pt.get("total") or 0)
                            if v > 0:
                                deployments[dep][key] += v
        except Exception:
            pass

        # Fetch projects for this resource
        projects: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                pr = await c.get(
                    f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg_name}"
                    f"/providers/Microsoft.CognitiveServices/accounts/{name}"
                    f"/projects?api-version={PROJ_VER}",
                    headers=_hdrs(token),
                )
            if pr.is_success:
                projects = [p["name"].split("/", 1)[-1] for p in pr.json().get("value", [])]
        except Exception:
            pass

        return {
            "resource": name,
            "rg": rg_name,
            "subId": sub_id,
            "subName": sub_names.get(sub_id, sub_id),
            "projects": projects,
            "deployments": dict(deployments),
        }

    results = await asyncio.gather(*[_fetch_resource(r) for r in resources])
    return list(results)
