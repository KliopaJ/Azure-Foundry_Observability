#!/usr/bin/env python3
"""Generate a landscape-oriented Graphviz architecture diagram for Foundry Observability."""

from __future__ import annotations

import graphviz
import pathlib

ASSETS = pathlib.Path(__file__).parent
ICONS = ASSETS / "icons"
PNG_NAME = "architecture-hierarchy-landscape"

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


def _icon_node(g: graphviz.Digraph, node_id: str, label: str, icon_key: str, **kwargs):
    g.node(
        node_id,
        label=f"""<
<TABLE BORDER=\"0\" CELLBORDER=\"0\" CELLSPACING=\"2\" CELLPADDING=\"4\">
  <TR><TD FIXEDSIZE=\"TRUE\" WIDTH=\"52\" HEIGHT=\"52\"><IMG SRC=\"{ICON[icon_key]}\" SCALE=\"TRUE\"/></TD></TR>
  <TR><TD><FONT POINT-SIZE=\"11\" FACE=\"Segoe UI,Helvetica\">{label}</FONT></TD></TR>
</TABLE>>""",
        **kwargs,
    )


def _text_node(g: graphviz.Digraph, node_id: str, title: str, lines: list[str], color: str):
    body = "<BR/>".join(lines)
    g.node(
        node_id,
        label=f"""<
<TABLE BORDER=\"1\" CELLBORDER=\"0\" CELLSPACING=\"0\" CELLPADDING=\"8\" COLOR=\"{color}\">
  <TR><TD><FONT POINT-SIZE=\"11\" FACE=\"Segoe UI,Helvetica\"><B>{title}</B></FONT></TD></TR>
  <TR><TD><FONT POINT-SIZE=\"10\" COLOR=\"{AZURE_GRAY}\" FACE=\"Segoe UI,Helvetica\">{body}</FONT></TD></TR>
</TABLE>>""",
        shape="plain",
    )


def build_diagram() -> graphviz.Digraph:
    graph = graphviz.Digraph(
        "FoundryObservabilityLandscape",
        format="png",
        engine="dot",
        graph_attr={
            "rankdir": "LR",
            "bgcolor": WHITE,
            "fontname": "Segoe UI,Helvetica",
            "pad": "0.5",
            "nodesep": "0.6",
            "ranksep": "1.2",
            "dpi": "220",
            "splines": "polyline",
            "newrank": "true",
            "concentrate": "true",
            "label": "<<FONT POINT-SIZE='22' COLOR='#002050'><B>Foundry Observability - Landscape Flow</B></FONT>>",
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

    with graph.subgraph(name="cluster_entry") as entry:
        entry.attr(
            label=f"<<FONT POINT-SIZE='13' COLOR='{AZURE_DARK}'><B>1. Access Layer</B></FONT>>",
            style="rounded,filled",
            color=AZURE_DARK,
            fillcolor="#F7F9FC",
            margin="14",
        )
        entry.attr(rank="same")
        _icon_node(entry, "user", "Admin /<BR/>Developer", "users")
        _icon_node(entry, "entra", "Microsoft<BR/>Entra ID", "entra-id")
        _icon_node(entry, "spa", "React SPA<BR/>(MSAL)", "app-registration")

    with graph.subgraph(name="cluster_app") as app:
        app.attr(
            label=f"<<FONT POINT-SIZE='13' COLOR='{AZURE_BLUE}'><B>2. Application Layer</B></FONT>>",
            style="rounded,filled",
            color=AZURE_BLUE,
            fillcolor="#EBF5FF",
            margin="14",
        )
        app.attr(rank="same")
        _icon_node(app, "backend", "FastAPI<BR/>Backend", "container-apps")
        _text_node(
            app,
            "features",
            "Backend",
            [
                "Config, metrics, pricing",
                "APIM policy CRUD",
                "Cost limits &amp; forecasts",
            ],
            AZURE_BLUE,
        )

    with graph.subgraph(name="cluster_gateway") as gateway:
        gateway.attr(
            label=f"<<FONT POINT-SIZE='13' COLOR='{AZURE_PURPLE}'><B>3. Governance Gateway</B></FONT>>",
            style="rounded,filled",
            color=AZURE_PURPLE,
            fillcolor="#F4EEFB",
            margin="14",
        )
        gateway.attr(rank="same")
        _icon_node(gateway, "apim", "Azure API<BR/>Management", "apim")
        _text_node(
            gateway,
            "controls",
            "Gateway",
            [
                "Per-user keys",
                "Rate limits &amp; TPM",
                "Key rotation",
            ],
            AZURE_PURPLE,
        )
        _icon_node(gateway, "clients", "AI Client<BR/>Scripts", "cognitive-services")

    with graph.subgraph(name="cluster_network") as network:
        network.attr(
            label=f"<<FONT POINT-SIZE='13' COLOR='{AZURE_TEAL}'><B>4. Private Network</B></FONT>>",
            style="rounded,filled",
            color=AZURE_TEAL,
            fillcolor="#EAF8F6",
            margin="14",
        )
        network.attr(rank="same")
        _icon_node(network, "private_endpoint", "Private<BR/>Endpoint", "private-link")
        _icon_node(network, "dns", "Private DNS<BR/>Zone", "dns-zone")
        _icon_node(network, "nsg", "APIM<BR/>NSG", "nsg")

    with graph.subgraph(name="cluster_ai") as ai:
        ai.attr(
            label=f"<<FONT POINT-SIZE='13' COLOR='{AZURE_ORANGE}'><B>5. Azure AI Runtime</B></FONT>>",
            style="rounded,filled",
            color=AZURE_ORANGE,
            fillcolor="#FFF4E8",
            margin="14",
        )
        ai.attr(rank="same")
        _icon_node(ai, "foundry", "Azure AI<BR/>Foundry", "ai-foundry")
        _icon_node(
            ai,
            "models",
            "Model<BR/>Deployments",
            "openai",
        )

    with graph.subgraph(name="cluster_observability") as obs:
        obs.attr(
            label=f"<<FONT POINT-SIZE='13' COLOR='{AZURE_GREEN}'><B>Observability</B></FONT>>",
            style="rounded,filled",
            color=AZURE_GREEN,
            fillcolor="#EAF6EA",
            margin="14",
        )
        obs.attr(rank="same")
        _icon_node(obs, "monitor", "Azure<BR/>Monitor", "monitor")
        _icon_node(obs, "appinsights", "Application<BR/>Insights", "app-insights")
        _icon_node(obs, "law", "Log Analytics<BR/>Workspace", "log-analytics")

    # Main flow edges
    graph.edge("user", "entra", label="Sign-in", color=AZURE_PURPLE, style="bold", penwidth="1.5", minlen="1")
    graph.edge("entra", "spa", label="ARM token", color=AZURE_PURPLE, style="bold", penwidth="1.5", minlen="1")
    graph.edge("user", "spa", label="Dashboard", color=AZURE_BLUE, minlen="1")

    graph.edge("spa", "backend", label="Bearer token + API", color=AZURE_BLUE, style="bold", penwidth="1.8", minlen="2")
    graph.edge("backend", "features", color=AZURE_BLUE, arrowhead="none", constraint="false")

    graph.edge("backend", "apim", label="Policy mgmt", color=AZURE_PURPLE, penwidth="1.4", minlen="2")
    graph.edge("clients", "apim", label="Chat API", color=AZURE_ORANGE, style="bold", penwidth="1.8", minlen="1", constraint="false")
    graph.edge("apim", "controls", color=AZURE_PURPLE, arrowhead="none", constraint="false")

    graph.edge("apim", "private_endpoint", label="Private path", color=AZURE_TEAL, style="bold", penwidth="1.8", minlen="2")
    graph.edge("private_endpoint", "foundry", label="Private Link", color=AZURE_TEAL, style="bold", penwidth="1.8", minlen="2")
    graph.edge("private_endpoint", "dns", label="DNS", color=AZURE_TEAL, style="dashed", constraint="false")
    graph.edge("apim", "nsg", label="NSG", color=AZURE_RED, style="dashed", constraint="false")

    graph.edge("foundry", "models", label="Deployments", color=AZURE_ORANGE, arrowhead="none", penwidth="1.4", constraint="false")

    # Observability connections
    graph.edge("backend", "monitor", label="Metrics", color=AZURE_GREEN, style="dashed", constraint="false")
    graph.edge("backend", "law", label="KQL", color=AZURE_BLUE, style="dashed", constraint="false")
    graph.edge("apim", "appinsights", label="Diagnostics", color=AZURE_PURPLE, style="bold", penwidth="1.5", constraint="false")
    graph.edge("appinsights", "law", label="Telemetry", color=AZURE_GREEN, style="dashed", constraint="false")
    graph.edge("foundry", "monitor", label="Token metrics", color=AZURE_GREEN, style="dashed", constraint="false")

    # Invisible main chain for ranking
    graph.edge("user", "spa", style="invis", weight="30")
    graph.edge("spa", "backend", style="invis", weight="30")
    graph.edge("backend", "apim", style="invis", weight="30")
    graph.edge("apim", "private_endpoint", style="invis", weight="30")
    graph.edge("private_endpoint", "foundry", style="invis", weight="30")

    return graph


if __name__ == "__main__":
    graph = build_diagram()
    output_path = graph.render(filename=PNG_NAME, directory=str(ASSETS), cleanup=True)
    print(f"Generated landscape diagram: {output_path}")
