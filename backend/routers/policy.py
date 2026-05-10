from fastapi import APIRouter, Header, Body
from typing import Optional, Dict, List
import httpx
import json
import re
import os
from pathlib import Path
from routers.subscriptions import _extract, _raise

router = APIRouter()
ARM         = "https://management.azure.com"
MGMT_VER    = "2022-08-01"
DEFAULT_TPM = int(os.environ.get("DEFAULT_TPM", "10000"))

# ── Static user / group registry ─────────────────────────────────────────────
USERS: List[Dict] = [
    {"apim_sub": "peter-parker",   "display": "Peter Parker",    "group": "superheroes"},
    {"apim_sub": "tonny-stark",    "display": "Tonny Stark",     "group": "superheroes"},
    {"apim_sub": "son-goku",       "display": "Son Goku",        "group": "manga"},
    {"apim_sub": "monkey-d-luffy", "display": "Monkey D. Luffy", "group": "manga"},
]
GROUPS: Dict[str, str] = {
    "superheroes": "Superheroes",
    "manga":       "Manga",
}
GROUP_MEMBERS: Dict[str, List[str]] = {
    gid: [u["apim_sub"] for u in USERS if u["group"] == gid]
    for gid in GROUPS
}


def _url(sub_id: str, rg: str, apim: str, api_id: str) -> str:
    return (
        f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg}"
        f"/providers/Microsoft.ApiManagement/service/{apim}"
        f"/apis/{api_id}/policies/policy?api-version={MGMT_VER}"
    )


def _hdrs(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── GET /api/users-groups ─────────────────────────────────────────────────────
# Queries Application Insights (via Log Analytics ARM proxy) for custom metrics
# emitted by the emit-metric APIM policy (AppMetrics table, Name="APIM Requests").
# Dimensions in Properties JSON: "Subscription ID", "Status" (success|blocked).
# NOTE: APIM StandardV2 does NOT support the classic Reports API.
LAW_NAME = os.environ.get("LAW_NAME", "clawpilot-law")

@router.get("/users-groups")
async def get_users_groups(
    sub_id: str, rg: str, apim: str,
    start: str, end: str,
    authorization: Optional[str] = Header(None),
):
    from collections import defaultdict

    token = _extract(authorization)
    start_dt = start.rstrip("Z").split(".")[0]
    end_dt   = end.rstrip("Z").split(".")[0]

    # KQL query on AppMetrics table (populated by emit-metric → App Insights)
    kql = (
        f'AppMetrics'
        f' | where Name == "APIM Requests"'
        f' | where TimeGenerated between(datetime("{start_dt}") .. datetime("{end_dt}"))'
        f' | extend SubId = tostring(parse_json(Properties)["Subscription ID"])'
        f' | extend Status = tostring(parse_json(Properties)["Status"])'
        f' | extend Deployment = tostring(parse_json(Properties)["Model Deployment"])'
        f' | where SubId !in ("", "master", "dev-testing")'
        f' | summarize TotalCount = sum(ItemCount) by SubId, Status, Deployment'
    )

    law_url = (
        f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg}"
        f"/providers/Microsoft.OperationalInsights/workspaces/{LAW_NAME}"
        f"/api/query?api-version=2020-08-01"
    )

    sub_totals: Dict[str, Dict[str, int]] = defaultdict(lambda: {"success": 0, "blocked": 0})
    # Per-user per-deployment stats: (sub, deployment) → {calls, blocked}
    user_dep_stats: Dict[tuple, Dict[str, int]] = defaultdict(lambda: {"calls": 0, "blocked": 0})

    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                law_url,
                json={"query": kql},
                headers=_hdrs(token),
            )
        if r.is_success:
            data = r.json()
            table = data.get("Tables", data.get("tables", [{}]))[0]
            cols_key = "Columns" if "Columns" in table else "columns"
            rows_key = "Rows" if "Rows" in table else "rows"
            name_key = "ColumnName" if cols_key == "Columns" else "name"
            col_names = [c[name_key] for c in table.get(cols_key, [])]
            for row in table.get(rows_key, []):
                rd = dict(zip(col_names, row))
                sub_name = rd.get("SubId", "")
                status = rd.get("Status", "success")
                deployment = rd.get("Deployment", "")
                count = int(rd.get("TotalCount", 0))
                if status == "success":
                    sub_totals[sub_name]["success"] += count
                else:
                    sub_totals[sub_name]["blocked"] += count
                # Per-user per-deployment breakdown
                if deployment and deployment != "unknown":
                    key = (sub_name, deployment)
                    if status == "success":
                        user_dep_stats[key]["calls"] += count
                    else:
                        user_dep_stats[key]["blocked"] += count
    except Exception:
        pass

    user_model_stats = [
        {"apimSub": sub, "deployment": dep, "calls": v["calls"], "blocked": v["blocked"]}
        for (sub, dep), v in sorted(user_dep_stats.items())
        if v["calls"] + v["blocked"] > 0
    ]

    users_activity = []
    for u in USERS:
        sub = u["apim_sub"]
        t = sub_totals.get(sub, {"success": 0, "blocked": 0})
        users_activity.append({
            "apimSub": sub,
            "display": u["display"],
            "group":   u["group"],
            "success": t["success"],
            "blocked": t["blocked"],
            "total":   t["success"] + t["blocked"],
        })

    groups_activity = []
    for gid, gname in GROUPS.items():
        members_data = [ua for ua in users_activity if ua["group"] == gid]
        groups_activity.append({
            "groupId": gid,
            "display": gname,
            "members": GROUP_MEMBERS.get(gid, []),
            "success": sum(m["success"] for m in members_data),
            "blocked": sum(m["blocked"] for m in members_data),
            "total":   sum(m["total"]   for m in members_data),
        })

    return {"users": users_activity, "groups": groups_activity, "userModelStats": user_model_stats}


# ── GET /api/policy ───────────────────────────────────────────────────────────
@router.get("/policy")
async def get_policy(
    sub_id: str, rg: str, apim: str, api_id: str,
    authorization: Optional[str] = Header(None),
):
    token = _extract(authorization)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(_url(sub_id, rg, apim, api_id) + "&format=rawxml", headers=_hdrs(token))
        if r.status_code == 404:
            return {"xml": None, "limits": {}, "userLimits": {}, "groupLimits": {}, "defaultTpm": DEFAULT_TPM}
        _raise(r)
        xml = r.content.decode("utf-8-sig")
        parsed = _parse_v2(xml)
        return {
            "xml":        xml,
            "limits":     parsed["deployments"],
            "userLimits": parsed["users"],
            "groupLimits": parsed["groups"],
            "defaultTpm": parsed["__default__"],
        }


# ── PUT /api/policy ───────────────────────────────────────────────────────────
@router.put("/policy")
async def put_policy(
    sub_id: str, rg: str, apim: str, api_id: str,
    body: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    token = _extract(authorization)
    deps             = body.get("deployments", [])
    dep_limits       = body.get("limits", {})
    dep_limit_types  = body.get("depLimitTypes", {})
    dep_cost_limits  = body.get("depCostLimits", {})
    dep_price_per_k  = body.get("depPricePerKTokens", {})
    default_tpm      = body.get("defaultTpm", DEFAULT_TPM)

    xml = _build_v2(
        deps=deps,
        dep_limits=dep_limits,
        user_limits=body.get("userLimits", {}),
        group_limits=body.get("groupLimits", {}),
        default_tpm=default_tpm,
        backend_id=body.get("backendId", ""),
        dep_limit_types=dep_limit_types,
        dep_cost_limits=dep_cost_limits,
        dep_price_per_k=dep_price_per_k,
        user_limit_types=body.get("userLimitTypes", {}),
        user_cost_limits=body.get("userCostLimits", {}),
        group_limit_types=body.get("groupLimitTypes", {}),
        group_cost_limits=body.get("groupCostLimits", {}),
        avg_price_per_k=body.get("avgPricePerKTokens"),
    )

    # Persist per-deployment limit configs to cost_limits.json
    if deps:
        cl_file = Path(__file__).parent.parent / "cost_limits.json"
        try:
            cl = json.loads(cl_file.read_text()) if cl_file.exists() else {}
            dep_configs = {}
            for d in deps:
                lt = dep_limit_types.get(d, "tpm")
                if lt == "cost":
                    dep_configs[d] = {
                        "type": "cost",
                        "value": float(dep_cost_limits.get(d, 0) or 0),
                        "pricePerKTokens": float(dep_price_per_k.get(d, 0.001) or 0.001),
                    }
                else:
                    dep_configs[d] = {"type": "tpm", "value": int(dep_limits.get(d, default_tpm))}
            cl["depLimitConfigs"] = dep_configs
            cl_file.write_text(json.dumps(cl, indent=2))
        except Exception:
            pass

    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.put(
            _url(sub_id, rg, apim, api_id),
            headers=_hdrs(token),
            json={"properties": {"format": "rawxml", "value": xml}},
        )
        _raise(r)
        parsed = _parse_v2(xml)
        return {
            "ok": True,
            "xml": xml,
            "limits": parsed["deployments"],
            "userLimits": parsed["users"],
            "groupLimits": parsed["groups"],
            "defaultTpm": parsed["__default__"],
        }


# ── DELETE /api/policy ────────────────────────────────────────────────────────
@router.delete("/policy")
async def delete_policy(
    sub_id: str, rg: str, apim: str, api_id: str,
    authorization: Optional[str] = Header(None),
):
    token = _extract(authorization)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.delete(_url(sub_id, rg, apim, api_id), headers=_hdrs(token))
        if r.status_code not in (200, 204, 404):
            _raise(r)
        return {"ok": True}


# ── Policy helpers ────────────────────────────────────────────────────────────
def _parse_v2(xml: str) -> Dict:
    result: Dict = {"deployments": {}, "users": {}, "groups": {}, "__default__": DEFAULT_TPM}
    for cond, block in re.findall(r'<when\s+condition="([^"]+)">(.*?)</when>', xml, re.DOTALL):
        tpm_m = re.search(r'tokens-per-minute="(\d+)"', block)
        if not tpm_m:
            continue
        tpm = int(tpm_m.group(1))
        dep_m = re.search(r'Foundry\.Deployment\s*==\s*&quot;([^&"]+)&quot;', cond)
        if dep_m:
            result["deployments"][dep_m.group(1)] = tpm
            continue
        usr_m = re.search(r'Subscription\.(?:Id|Name)\s*==\s*&quot;([^&"]+)&quot;', cond)
        if usr_m:
            result["users"][usr_m.group(1)] = tpm
            continue
        grp_key = re.search(r'counter-key="[^"]*group/([^/&"]+)', block)
        if grp_key:
            result["groups"][grp_key.group(1)] = tpm
    otherwise_m = re.search(r'<otherwise>(.*?)</otherwise>', xml, re.DOTALL)
    if otherwise_m:
        dflt_m = re.search(r'tokens-per-minute="(\d+)"', otherwise_m.group(1))
        if dflt_m:
            result["__default__"] = int(dflt_m.group(1))
    return result


def _build_v2(
    deps: List[str],
    dep_limits: Dict,
    user_limits: Dict,
    group_limits: Dict,
    default_tpm: int,
    backend_id: str,
    dep_limit_types: Dict = None,
    dep_cost_limits: Dict = None,
    dep_price_per_k: Dict = None,
    user_limit_types: Dict = None,
    user_cost_limits: Dict = None,
    group_limit_types: Dict = None,
    group_cost_limits: Dict = None,
    avg_price_per_k: float = None,
) -> str:
    """Build policy XML with 3 independent throttle layers: user → group → deployment."""
    dep_limit_types = dep_limit_types or {}
    dep_cost_limits = dep_cost_limits or {}
    dep_price_per_k = dep_price_per_k or {}
    user_limit_types = user_limit_types or {}
    user_cost_limits = user_cost_limits or {}
    group_limit_types = group_limit_types or {}
    group_cost_limits = group_cost_limits or {}

    # Epoch suffix rotates counter-keys so each Apply resets APIM's
    # sliding-window buckets immediately (old buckets expire on their own).
    import time as _time
    epoch = str(int(_time.time()))

    def _cost_to_tpm(budget: float, price_k: float) -> int:
        """Convert a monthly $ budget to TPM using $/1K-token rate."""
        if budget > 0 and price_k > 0:
            monthly_tokens = (budget / price_k) * 1_000
            return max(1, int(monthly_tokens / 43_200))  # 30d × 24h × 60m
        return default_tpm

    def _eff_tpm(d: str) -> int:
        """Return effective TPM for a deployment (converts cost budget if needed)."""
        lt = dep_limit_types.get(d, "tpm")
        if lt == "cost":
            budget  = float(dep_cost_limits.get(d, 0) or 0)
            price_k = float(dep_price_per_k.get(d, 0.001) or 0.001)
            return _cost_to_tpm(budget, price_k)
        return int(dep_limits.get(d, default_tpm))

    def _user_tpm(sub: str) -> int:
        """Return effective TPM for a user (converts cost budget if needed)."""
        if user_limit_types.get(sub) == "cost" and avg_price_per_k:
            budget = float(user_cost_limits.get(sub, 0) or 0)
            return _cost_to_tpm(budget, avg_price_per_k)
        return int(user_limits.get(sub, default_tpm))

    def _group_tpm(gid: str) -> int:
        """Return effective TPM for a group (converts cost budget if needed)."""
        if group_limit_types.get(gid) == "cost" and avg_price_per_k:
            budget = float(group_cost_limits.get(gid, 0) or 0)
            return _cost_to_tpm(budget, avg_price_per_k)
        return int(group_limits.get(gid, default_tpm))

    # Block 1: per-user
    # NOTE: context.Subscription.Id returns the resource name (e.g. "tonny-stark");
    # context.Subscription.Name returns the displayName (e.g. "Tonny Stark").
    user_whens = ""
    for u in USERS:
        sub = u["apim_sub"]
        tpm = _user_tpm(sub)
        user_whens += (
            f'<when condition="@(context.Subscription.Id == &quot;{sub}&quot;)">'
            f'<llm-token-limit counter-key="@(&quot;user/{sub}/{epoch}&quot;)"'
            f' tokens-per-minute="{tpm}" estimate-prompt-tokens="false" /></when>'
        )

    # Block 2: per-group
    group_whens = ""
    for gid in GROUPS:
        members = GROUP_MEMBERS.get(gid, [])
        if not members:
            continue
        tpm = _group_tpm(gid)
        members_cs = ",".join(f'&quot;{m}&quot;' for m in members)
        group_whens += (
            f'<when condition="@(new string[]{{{members_cs}}}.Contains(context.Subscription.Id))">'
            f'<llm-token-limit counter-key="@(&quot;group/{gid}/{epoch}&quot;)"'
            f' tokens-per-minute="{tpm}" estimate-prompt-tokens="false" /></when>'
        )

    # Block 3: per-deployment
    dep_whens = ""
    for d in deps:
        tpm = _eff_tpm(d)
        dep_whens += (
            f'<when condition="@(context.Request.Foundry.Deployment == &quot;{d}&quot;)">'
            f'<llm-token-limit'
            f' counter-key="@(&quot;dep/&quot; + (string)context.Request.Foundry.Deployment + &quot;/{epoch}&quot;)"'
            f' tokens-per-minute="{tpm}" estimate-prompt-tokens="false" /></when>'
        )
    dflt = _eff_tpm("__default__") if "__default__" in dep_limits else default_tpm

    return (
        "<policies><inbound><base />"
        f'<set-backend-service id="apim-generated-policy" backend-id="{backend_id}" />'
        '<authentication-managed-identity resource="https://cognitiveservices.azure.com"'
        ' output-token-variable-name="msi-access-token" ignore-error="false" />'
        '<set-header name="Authorization" exists-action="override">'
        '<value>@("Bearer " + (string)context.Variables["msi-access-token"])</value>'
        '</set-header>'
        '<set-header name="api-key" exists-action="delete" />'
        f"<choose>{user_whens}</choose>"
        f"<choose>{group_whens}</choose>"
        f"<choose>{dep_whens}"
        f'<otherwise><llm-token-limit'
        f' counter-key="@(&quot;dep/&quot; + (string)context.Request.Foundry.Deployment + &quot;/{epoch}&quot;)"'
        f' tokens-per-minute="{dflt}" estimate-prompt-tokens="false" /></otherwise>'
        f"</choose>"
        f"</inbound><backend><base /></backend>"
        f'<outbound><base />'
        f'<emit-metric name="APIM Requests" namespace="ClawPilot">'
        f'<dimension name="Subscription ID" />'
        f'<dimension name="Model Deployment"'
        f' value="@(context.Request.MatchedParameters.GetValueOrDefault(&quot;deployment-id&quot;, &quot;unknown&quot;))" />'
        f'<dimension name="Status" value="success" />'
        f'</emit-metric></outbound>'
        f'<on-error><base />'
        f'<emit-metric name="APIM Requests" namespace="ClawPilot">'
        f'<dimension name="Subscription ID" />'
        f'<dimension name="Model Deployment"'
        f' value="@(context.Request.MatchedParameters.GetValueOrDefault(&quot;deployment-id&quot;, &quot;unknown&quot;))" />'
        f'<dimension name="Status" value="blocked" />'
        f'</emit-metric></on-error></policies>'
    )
