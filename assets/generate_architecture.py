#!/usr/bin/env python3
"""Generate the Foundry Observability architecture diagram using Graphviz with official Azure icons."""

from __future__ import annotations

import graphviz
import pathlib

ASSETS = pathlib.Path(__file__).parent
ICONS = ASSETS / "icons"
PNG_NAME = "architecture"

# ── Azure-palette colours ────────────────────────────────────────────────────
AZURE_BLUE = "#0078D4"
AZURE_DARK = "#002050"
AZURE_GREEN = "#107C10"
AZURE_PURPLE = "#5C2D91"
AZURE_ORANGE = "#FF8C00"
AZURE_RED = "#E81123"
AZURE_TEAL = "#008272"
AZURE_GRAY = "#737373"
WHITE = "#FFFFFF"

# ── Icon lookup ──────────────────────────────────────────────────────────────
ICON = {k: str(ICONS / f"{k}.png") for k in [
    "entra-id", "apim", "ai-foundry", "openai", "monitor", "app-insights",
    "log-analytics", "resource-graph", "vnet", "nsg", "private-link",
    "dns-zone", "subnet", "container-apps", "users", "cognitive-services",
    "app-registration",
]}


def _node(g, nid: str, label: str, icon_key: str, **kw):
    """Add a node with an official Azure icon above the label."""
    g.node(
        nid,
        label=f"""<
<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="2" CELLPADDING="4">
  <TR><TD FIXEDSIZE="TRUE" WIDTH="48" HEIGHT="48"><IMG SRC="{ICON[icon_key]}" SCALE="TRUE"/></TD></TR>
  <TR><TD><FONT POINT-SIZE="11" FACE="Segoe UI,Helvetica">{label}</FONT></TD></TR>
</TABLE>>""",
        **kw,
    )


def build_diagram() -> graphviz.Digraph:
    g = graphviz.Digraph(
        "FoundryObservability",
        format="png",
        engine="dot",
        graph_attr={
            "rankdir": "LR",
            "bgcolor": WHITE,
            "fontname": "Segoe UI,Helvetica",
            "pad": "0.5",
            "nodesep": "0.7",
            "ranksep": "1.4",
            "dpi": "200",
            "label": "<<FONT POINT-SIZE='22' COLOR='#002050'><B>Foundry Observability — Architecture</B></FONT>>",
            "labelloc": "t",
            "labeljust": "c",
            "compound": "true",
        },
        node_attr={
            "shape": "none",
            "fontname": "Segoe UI,Helvetica",
            "fontsize": "10",
        },
        edge_attr={
            "fontname": "Segoe UI,Helvetica",
            "fontsize": "9",
            "color": AZURE_GRAY + "AA",
            "arrowsize": "0.8",
            "penwidth": "1.2",
        },
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # CLIENT TIER
    # ═══════════════════════════════════════════════════════════════════════════
    with g.subgraph(name="cluster_client") as c:
        c.attr(
            label=f"""<<FONT POINT-SIZE='13' COLOR='{AZURE_GRAY}'><B>Client Tier</B></FONT>>""",
            style="rounded,dashed",
            color=AZURE_GRAY,
            bgcolor="#FAFAFA",
            margin="20",
        )
        _node(c, "entra", "Microsoft<BR/>Entra ID", "entra-id")
        _node(c, "admin", "Admin / Dev", "users")
        _node(c, "spa", "React SPA<BR/>(MSAL Auth)", "app-registration")
        _node(c, "clients", "AI Client<BR/>Scripts", "cognitive-services")

    # ═══════════════════════════════════════════════════════════════════════════
    # APPLICATION TIER
    # ═══════════════════════════════════════════════════════════════════════════
    with g.subgraph(name="cluster_app") as a:
        a.attr(
            label=f"""<<FONT POINT-SIZE='13' COLOR='{AZURE_BLUE}'><B>Application Tier  (Docker + uvicorn)</B></FONT>>""",
            style="rounded,filled",
            color=AZURE_BLUE,
            fillcolor="#EBF5FF",
            margin="20",
        )
        _node(a, "fastapi", "FastAPI<BR/>Backend", "container-apps")

    # ═══════════════════════════════════════════════════════════════════════════
    # AZURE VNET
    # ═══════════════════════════════════════════════════════════════════════════
    with g.subgraph(name="cluster_vnet") as v:
        v.attr(
            label=f"""<<FONT POINT-SIZE='13' COLOR='{AZURE_TEAL}'><B>Azure VNet  (10.0.0.0/16)</B></FONT>>""",
            style="rounded,filled",
            color=AZURE_TEAL,
            fillcolor="#E6F7F5",
            margin="16",
        )

        with v.subgraph(name="cluster_snet_apim") as s1:
            s1.attr(
                label=f"""<<FONT POINT-SIZE='10' COLOR='{AZURE_GRAY}'>snet-apim  (10.0.1.0/24)</FONT>>""",
                style="rounded,dashed",
                color=AZURE_TEAL + "88",
                margin="12",
            )
            _node(s1, "apim", "Azure API<BR/>Management", "apim")
            _node(s1, "nsg", "NSG", "nsg")

        with v.subgraph(name="cluster_snet_pe") as s2:
            s2.attr(
                label=f"""<<FONT POINT-SIZE='10' COLOR='{AZURE_GRAY}'>snet-private-endpoints  (10.0.2.0/24)</FONT>>""",
                style="rounded,dashed",
                color=AZURE_TEAL + "88",
                margin="12",
            )
            _node(s2, "pe", "Private<BR/>Endpoint", "private-link")
            _node(s2, "dns", "Private<BR/>DNS Zone", "dns-zone")

    # ═══════════════════════════════════════════════════════════════════════════
    # OBSERVABILITY
    # ═══════════════════════════════════════════════════════════════════════════
    with g.subgraph(name="cluster_obs") as o:
        o.attr(
            label=f"""<<FONT POINT-SIZE='13' COLOR='{AZURE_GREEN}'><B>Observability</B></FONT>>""",
            style="rounded,filled",
            color=AZURE_GREEN,
            fillcolor="#E8F5E9",
            margin="20",
        )
        _node(o, "monitor", "Azure<BR/>Monitor", "monitor")
        _node(o, "appinsights", "Application<BR/>Insights", "app-insights")
        _node(o, "law", "Log Analytics<BR/>Workspace", "log-analytics")
        _node(o, "resourcegraph", "Resource<BR/>Graph", "resource-graph")

    # ═══════════════════════════════════════════════════════════════════════════
    # AI SERVICES
    # ═══════════════════════════════════════════════════════════════════════════
    with g.subgraph(name="cluster_ai") as ai:
        ai.attr(
            label=f"""<<FONT POINT-SIZE='13' COLOR='{AZURE_ORANGE}'><B>Azure AI Services</B></FONT>>""",
            style="rounded,filled",
            color=AZURE_ORANGE,
            fillcolor="#FFF3E0",
            margin="20",
        )
        _node(ai, "foundry", "Azure AI<BR/>Foundry", "ai-foundry")
        _node(ai, "models", "Model Deployments<BR/><FONT POINT-SIZE='9' COLOR='#737373'>GPT · DeepSeek · Kimi<BR/>Llama · Phi · MAI</FONT>", "openai")

    # ═══════════════════════════════════════════════════════════════════════════
    # EDGES
    # ═══════════════════════════════════════════════════════════════════════════

    # Auth flow
    g.edge("admin", "entra", label="OAuth2 PKCE", color=AZURE_PURPLE, style="bold", penwidth="1.5")
    g.edge("entra", "spa", label="JWT Token", color=AZURE_PURPLE, style="bold", penwidth="1.5")
    g.edge("admin", "spa", label="HTTPS", color=AZURE_BLUE)

    # SPA → App tier
    g.edge("spa", "fastapi", label="Bearer Token", color=AZURE_BLUE, style="bold", penwidth="1.8")

    # App tier → Azure services
    g.edge("fastapi", "apim", label="ARM REST\n(Policy Mgmt)", color=AZURE_PURPLE, penwidth="1.3")
    g.edge("fastapi", "monitor", label="Metrics Query", color=AZURE_GREEN, style="dashed")
    g.edge("fastapi", "resourcegraph", label="Discovery", color=AZURE_BLUE, style="dashed")
    g.edge("fastapi", "law", label="KQL Queries", color=AZURE_BLUE, style="dashed", constraint="false")

    # AI Clients → APIM
    g.edge("clients", "apim", label="APIM Key\n+ Chat API", color=AZURE_ORANGE, style="bold", penwidth="2")

    # APIM → Private Link → Foundry
    g.edge("apim", "pe", label="Private Link", color=AZURE_TEAL, style="bold", penwidth="2")
    g.edge("pe", "foundry", label="Private Endpoint", color=AZURE_TEAL, style="bold", penwidth="2")
    g.edge("pe", "dns", color=AZURE_TEAL, style="dashed", arrowhead="none")
    g.edge("apim", "nsg", style="dashed", color=AZURE_RED, arrowhead="none", constraint="false")

    # APIM → Observability
    g.edge("apim", "appinsights", label="Diagnostics\n100% sampling", color=AZURE_PURPLE, style="bold", penwidth="1.5")
    g.edge("appinsights", "law", label="Telemetry", color=AZURE_BLUE, style="dashed")

    # Foundry internals
    g.edge("foundry", "models", color=AZURE_ORANGE, arrowhead="none", style="bold", penwidth="1.5")
    g.edge("foundry", "monitor", label="Token Metrics", color=AZURE_GREEN, style="dashed", constraint="false")

    return g


if __name__ == "__main__":
    g = build_diagram()
    out_path = g.render(filename=PNG_NAME, directory=str(ASSETS), cleanup=True)
    print(f"✅ Graphviz architecture diagram: {out_path}")
