#!/usr/bin/env python3
"""Generate a simple one-row landscape architecture diagram for Foundry Observability."""

from __future__ import annotations

import graphviz
import pathlib

ASSETS = pathlib.Path(__file__).parent
ICONS = ASSETS / "icons"
PNG_NAME = "architecture-simple-landscape"

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


def _icon_node(g: graphviz.Digraph, node_id: str, label: str, icon_key: str, color: str = AZURE_GRAY, **kwargs):
    g.node(
        node_id,
        label=f"""<
<TABLE BORDER=\"0\" CELLBORDER=\"0\" CELLSPACING=\"2\" CELLPADDING=\"6\">
  <TR><TD FIXEDSIZE=\"TRUE\" WIDTH=\"56\" HEIGHT=\"56\"><IMG SRC=\"{ICON[icon_key]}\" SCALE=\"TRUE\"/></TD></TR>
  <TR><TD><FONT POINT-SIZE=\"10\" FACE=\"Segoe UI,Helvetica\"><B>{label}</B></FONT></TD></TR>
</TABLE>>""",
        **kwargs,
    )


def build_diagram() -> graphviz.Digraph:
    graph = graphviz.Digraph(
        "FoundryObservabilitySimple",
        format="png",
        engine="dot",
        graph_attr={
            "rankdir": "LR",
            "bgcolor": WHITE,
            "fontname": "Segoe UI,Helvetica",
            "pad": "0.6",
            "nodesep": "0.5",
            "ranksep": "1.8",
            "dpi": "200",
            "splines": "polyline",
            "label": "<<FONT POINT-SIZE='20' COLOR='#002050'><B>Foundry Observability - Flow Diagram</B></FONT>>",
            "labelloc": "t",
            "labeljust": "c",
        },
        node_attr={
            "shape": "none",
            "fontname": "Segoe UI,Helvetica",
            "fontsize": "10",
        },
        edge_attr={
            "fontname": "Segoe UI,Helvetica",
            "fontsize": "10",
            "color": AZURE_GRAY + "CC",
            "arrowsize": "1.2",
            "penwidth": "1.8",
        },
    )

    # Main flow - left to right
    _icon_node(graph, "user", "User", "users")
    _icon_node(graph, "entra", "Entra ID", "entra-id")
    _icon_node(graph, "spa", "React SPA", "app-registration")
    _icon_node(graph, "backend", "FastAPI", "container-apps")
    _icon_node(graph, "apim", "APIM", "apim")
    _icon_node(graph, "clients", "Clients", "cognitive-services")
    _icon_node(graph, "pe", "Private Link", "private-link")
    _icon_node(graph, "foundry", "AI Foundry", "ai-foundry")
    _icon_node(graph, "models", "Models", "openai")

    # Observability nodes (secondary)
    _icon_node(graph, "monitor", "Monitor", "monitor")
    _icon_node(graph, "appinsights", "App Insights", "app-insights")
    _icon_node(graph, "law", "Log Analytics", "log-analytics")

    # Main flow edges
    graph.edge("user", "entra", label="Sign-in", color=AZURE_PURPLE, penwidth="2", fontsize="10")
    graph.edge("entra", "spa", label="ARM token", color=AZURE_PURPLE, penwidth="2", fontsize="10")
    graph.edge("spa", "backend", label="API + Bearer", color=AZURE_BLUE, penwidth="2.2", fontsize="10", style="bold")
    graph.edge("backend", "apim", label="Policy Mgmt", color=AZURE_PURPLE, penwidth="1.8", fontsize="10")
    graph.edge("clients", "apim", label="Chat API", color=AZURE_ORANGE, penwidth="2.2", fontsize="10", style="bold")
    graph.edge("apim", "pe", label="Private Path", color=AZURE_TEAL, penwidth="2.2", fontsize="10", style="bold")
    graph.edge("pe", "foundry", label="Private Link", color=AZURE_TEAL, penwidth="2.2", fontsize="10", style="bold")
    graph.edge("foundry", "models", label="Deployments", color=AZURE_ORANGE, penwidth="1.8", fontsize="10")

    # Observability pull edges (dashed, secondary)
    graph.edge("backend", "monitor", label="Metrics", color=AZURE_GREEN, style="dashed", penwidth="1.4", fontsize="9")
    graph.edge("apim", "appinsights", label="Diagnostics", color=AZURE_PURPLE, style="dashed", penwidth="1.4", fontsize="9")
    graph.edge("appinsights", "law", label="Telemetry", color=AZURE_GREEN, style="dashed", penwidth="1.4", fontsize="9")
    graph.edge("foundry", "monitor", label="Token Metrics", color=AZURE_GREEN, style="dashed", penwidth="1.4", fontsize="9")

    return graph


if __name__ == "__main__":
    graph = build_diagram()
    output_path = graph.render(filename=PNG_NAME, directory=str(ASSETS), cleanup=True)
    print(f"Generated simple landscape diagram: {output_path}")
