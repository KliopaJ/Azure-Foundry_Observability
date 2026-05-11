#!/usr/bin/env python3
"""Generate landscape diagram with component roles and responsibilities."""

from __future__ import annotations

import graphviz
import pathlib

ASSETS = pathlib.Path(__file__).parent
ICONS = ASSETS / "icons"
PNG_NAME = "architecture-flow-with-roles"

AZURE_BLUE = "#0078D4"
AZURE_DARK = "#002050"
AZURE_GREEN = "#107C10"
AZURE_PURPLE = "#5C2D91"
AZURE_ORANGE = "#FF8C00"
AZURE_RED = "#E81123"
AZURE_TEAL = "#008272"
AZURE_GRAY = "#737373"
WHITE = "#FFFFFF"

ICON = {k: str(ICONS / f"{k}.png") for k in [
    "entra-id",
    "apim",
    "ai-foundry",
    "openai",
    "monitor",
    "app-insights",
    "log-analytics",
    "resource-graph",
    "nsg",
    "private-link",
    "dns-zone",
    "container-apps",
    "users",
    "cognitive-services",
    "app-registration",
]}


def _component_node(g: graphviz.Digraph, node_id: str, icon_key: str, title: str, responsibilities: list[str], color: str):
    """Create a component node with icon, title, and responsibilities."""
    resp_text = "<BR/>".join(responsibilities)
    g.node(
        node_id,
        label=f"""<
<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="8" COLOR="{color}" BGCOLOR="white">
  <TR>
    <TD ROWSPAN="2" FIXEDSIZE="TRUE" WIDTH="60" HEIGHT="60"><IMG SRC="{ICON[icon_key]}" SCALE="TRUE"/></TD>
    <TD><FONT POINT-SIZE="12" FACE="Segoe UI,Helvetica"><B>{title}</B></FONT></TD>
  </TR>
  <TR>
    <TD><FONT POINT-SIZE="8" COLOR="{AZURE_GRAY}" FACE="Segoe UI,Helvetica">{resp_text}</FONT></TD>
  </TR>
</TABLE>>""",
        shape="plain",
    )


def build_diagram() -> graphviz.Digraph:
    graph = graphviz.Digraph(
        "FoundryObservabilityWithRoles",
        format="png",
        engine="dot",
        graph_attr={
            "rankdir": "LR",
            "bgcolor": WHITE,
            "fontname": "Segoe UI,Helvetica",
            "pad": "0.7",
            "nodesep": "0.4",
            "ranksep": "2.2",
            "dpi": "180",
            "splines": "polyline",
            "label": "<<FONT POINT-SIZE='20' COLOR='#002050'><B>Foundry Observability - Component Responsibilities</B></FONT>>",
            "labelloc": "t",
            "labeljust": "c",
        },
        node_attr={
            "shape": "none",
            "fontname": "Segoe UI,Helvetica",
        },
        edge_attr={
            "fontname": "Segoe UI,Helvetica",
            "fontsize": "9",
            "color": AZURE_GRAY + "BB",
            "arrowsize": "1.0",
            "penwidth": "1.6",
        },
    )

    # Main flow components with roles
    _component_node(
        graph,
        "user",
        "users",
        "User",
        ["Initiates requests", "Authenticates via Entra ID"],
        AZURE_DARK,
    )

    _component_node(
        graph,
        "entra",
        "entra-id",
        "Entra ID",
        ["OAuth2 PKCE flow", "Issues ARM-scoped JWT tokens"],
        AZURE_PURPLE,
    )

    _component_node(
        graph,
        "spa",
        "app-registration",
        "React SPA",
        ["Dashboard UI", "Token mgmt, MSAL auth"],
        AZURE_BLUE,
    )

    _component_node(
        graph,
        "backend",
        "container-apps",
        "FastAPI Backend",
        ["REST API server", "ARM proxy, metrics queries"],
        AZURE_BLUE,
    )

    _component_node(
        graph,
        "apim",
        "apim",
        "APIM Gateway",
        ["Rate limits &amp; TPM quotas", "Per-user subscription keys"],
        AZURE_PURPLE,
    )

    _component_node(
        graph,
        "clients",
        "cognitive-services",
        "AI Clients",
        ["Consume chat completions", "Simulate usage patterns"],
        AZURE_ORANGE,
    )

    _component_node(
        graph,
        "pe",
        "private-link",
        "Private Link",
        ["Secure private path", "Network isolation layer"],
        AZURE_TEAL,
    )

    _component_node(
        graph,
        "foundry",
        "ai-foundry",
        "AI Foundry",
        ["Hosts AI models", "Manages deployments"],
        AZURE_ORANGE,
    )

    _component_node(
        graph,
        "models",
        "openai",
        "Models",
        ["GPT-5.4-mini, Kimi-K2.5", "DeepSeek, Llama, Phi"],
        AZURE_ORANGE,
    )

    # Observability components
    _component_node(
        graph,
        "monitor",
        "monitor",
        "Azure Monitor",
        ["Token metrics", "Deployment KPIs"],
        AZURE_GREEN,
    )

    _component_node(
        graph,
        "appinsights",
        "app-insights",
        "App Insights",
        ["APIM diagnostics", "Request/response logging"],
        AZURE_GREEN,
    )

    _component_node(
        graph,
        "law",
        "log-analytics",
        "Log Analytics",
        ["Telemetry storage", "KQL query engine"],
        AZURE_GREEN,
    )

    # Main flow edges
    graph.edge("user", "entra", label="Sign-in", color=AZURE_PURPLE, penwidth="2", fontsize="9")
    graph.edge("entra", "spa", label="JWT token", color=AZURE_PURPLE, penwidth="2", fontsize="9")
    graph.edge("spa", "backend", label="API calls + Bearer", color=AZURE_BLUE, penwidth="2.2", fontsize="9", style="bold")
    graph.edge("backend", "apim", label="Policy management", color=AZURE_PURPLE, penwidth="1.8", fontsize="9")
    graph.edge("clients", "apim", label="Chat API requests", color=AZURE_ORANGE, penwidth="2.2", fontsize="9", style="bold")
    graph.edge("apim", "pe", label="Backend calls", color=AZURE_TEAL, penwidth="2.2", fontsize="9", style="bold")
    graph.edge("pe", "foundry", label="Private endpoint", color=AZURE_TEAL, penwidth="2.2", fontsize="9", style="bold")
    graph.edge("foundry", "models", color=AZURE_ORANGE, arrowhead="none", penwidth="1.6", fontsize="9")

    # Observability edges (dashed, secondary)
    graph.edge("backend", "monitor", label="Metrics queries", color=AZURE_GREEN, style="dashed", penwidth="1.3", fontsize="8")
    graph.edge("apim", "appinsights", label="Diagnostics", color=AZURE_PURPLE, style="dashed", penwidth="1.3", fontsize="8")
    graph.edge("appinsights", "law", label="Telemetry feed", color=AZURE_GREEN, style="dashed", penwidth="1.3", fontsize="8")
    graph.edge("foundry", "monitor", label="Token metrics", color=AZURE_GREEN, style="dashed", penwidth="1.3", fontsize="8")

    return graph


if __name__ == "__main__":
    graph = build_diagram()
    output_path = graph.render(filename=PNG_NAME, directory=str(ASSETS), cleanup=True)
    print(f"Generated flow diagram with roles: {output_path}")
