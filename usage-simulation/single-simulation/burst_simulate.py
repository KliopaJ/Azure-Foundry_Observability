"""
burst_simulate.py — Rapid-fire calls to trigger APIM 429 throttling.

Sends many requests in quick succession through the APIM gateway to exceed
TPM limits and provoke rate-limit (429) responses.

Usage:
    python burst_simulate.py --user peter-parker
    python burst_simulate.py --user peter-parker --rounds 20
    python burst_simulate.py --user tonny-stark --deployment DeepSeek-V3.2
    python burst_simulate.py --user son-goku --deployment Llama-4-Maverick-17B-128E-Instruct-FP8
    python burst_simulate.py --user peter-parker --deployment gpt-5.3-codex
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_root / ".env")
load_dotenv(_root / "usage-simulation" / ".env")

from simulate_user import (
    USERS, APIM_GATEWAY_URL, DEPLOYMENT_GPT,
    build_client, get_pricing, estimate_cost,
)

BURST_PROMPTS = [
    "Write a detailed 2000-word essay about the history of artificial intelligence from the 1950s to today.",
    "Explain quantum computing in extreme detail — cover qubits, superposition, entanglement, quantum gates, error correction, and real-world applications.",
    "Write a comprehensive guide to microservices architecture covering service discovery, API gateways, circuit breakers, event sourcing, CQRS, and observability.",
    "Describe the entire TCP/IP networking stack in detail — every layer, every protocol, with examples of packet flow.",
    "Write a thorough comparison of every major cloud provider (Azure, AWS, GCP) covering compute, storage, networking, AI/ML, and pricing models.",
    "Explain the complete Kubernetes architecture in depth — control plane, worker nodes, pods, services, ingress, operators, CRDs, and autoscaling.",
    "Write a detailed tutorial on building a production-grade CI/CD pipeline with GitHub Actions, Docker, Terraform, and Kubernetes.",
    "Explain distributed systems consensus algorithms (Paxos, Raft, PBFT) with pseudocode and failure scenarios.",
    "Write a comprehensive guide to database internals — B-trees, LSM-trees, WAL, MVCC, query planning, and indexing strategies.",
    "Describe the complete lifecycle of an HTTP request from browser to server and back — DNS, TLS handshake, TCP, routing, load balancing, and caching.",
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Burst simulation to trigger APIM 429 throttling",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--user", required=True, choices=list(USERS.keys()),
        help="APIM subscription user to simulate",
    )
    parser.add_argument(
        "--deployment", default=DEPLOYMENT_GPT,
        help=f"Model deployment name (default: {DEPLOYMENT_GPT})",
    )
    parser.add_argument(
        "--rounds", type=int, default=15,
        help="Number of rapid calls to make (default: 15)",
    )
    parser.add_argument(
        "--delay", type=float, default=0.0,
        help="Seconds between calls (default: 0 — no delay)",
    )
    parser.add_argument(
        "--max-tokens", type=int, default=4096,
        help="Max completion tokens per call (default: 4096)",
    )
    args = parser.parse_args()

    user = USERS[args.user]
    key = os.environ.get(user["key_env"], "")
    if not key:
        print(f"ERROR: Environment variable {user['key_env']} is not set.")
        sys.exit(1)

    prompts = (BURST_PROMPTS * ((args.rounds // len(BURST_PROMPTS)) + 1))[:args.rounds]
    client = build_client(key)
    now = datetime.now().astimezone()  # local timezone
    timestamp = now.strftime("%Y-%m-%d_%H-%M-%S")
    out_file = Path(__file__).resolve().parent / f"burst_simulate--reply-{timestamp}.md"
    inp_rate, out_rate = get_pricing(args.deployment)

    print(
        f"{'=' * 60}\n"
        f"  ⚡ BURST MODE — trigger 429 throttling\n"
        f"{'=' * 60}\n"
        f"  User       : {user['display']} ({args.user})\n"
        f"  Group      : {user['group']}\n"
        f"  Deployment : {args.deployment}\n"
        f"  Gateway    : {APIM_GATEWAY_URL}\n"
        f"  APIM key   : ...{key[-6:]}\n"
        f"  Rounds     : {args.rounds}\n"
        f"  Delay      : {args.delay}s\n"
        f"  Max tokens : {args.max_tokens}\n"
        f"  Output     : {out_file.name}\n"
        f"{'=' * 60}"
    )

    md_lines = [
        f"# Burst Simulation — {user['display']}",
        "",
        "| Field | Value |",
        "|-------|-------|",
        f"| User | {user['display']} (`{args.user}`) |",
        f"| Group | {user['group']} |",
        f"| Deployment | `{args.deployment}` |",
        f"| Rounds | {args.rounds} |",
        f"| Max tokens | {args.max_tokens} |",
        f"| Delay | {args.delay}s |",
        f"| Timestamp | {now.strftime('%Y-%m-%d %H:%M:%S %Z')} |",
        "",
        "---",
        "",
    ]

    total_input = 0
    total_output = 0
    total_cost = 0.0
    successes = 0
    throttles = 0
    errors = 0
    first_429_at = None

    for i, prompt in enumerate(prompts, 1):
        short = prompt[:80] + ("…" if len(prompt) > 80 else "")
        print(f"\n[{i}/{len(prompts)}] {short}")

        try:
            resp = client.chat.completions.create(
                model=args.deployment,
                messages=[
                    {"role": "system", "content": user["system"]},
                    {"role": "user", "content": prompt},
                ],
                max_completion_tokens=args.max_tokens,
                temperature=0.8,
            )
            usage = resp.usage
            inp_tok = usage.prompt_tokens if usage else 0
            out_tok = usage.completion_tokens if usage else 0
            cost = estimate_cost(args.deployment, inp_tok, out_tok)
            total_input += inp_tok
            total_output += out_tok
            total_cost += cost
            successes += 1

            reply_preview = (resp.choices[0].message.content or "")[:200]
            print(f"  ✓ {inp_tok} in / {out_tok} out · ${cost:.6f}")

            md_lines.append(f"## Call {i} — ✓ Success")
            md_lines.append(f"> {short}")
            md_lines.append("")
            md_lines.append(f"Tokens: {inp_tok} in / {out_tok} out · Cost: ${cost:.6f}")
            md_lines.append("")
            md_lines.append(f"<details><summary>Response preview</summary>\n\n{reply_preview}…\n\n</details>")
            md_lines.append("")

        except Exception as exc:
            msg = str(exc)
            if "429" in msg:
                throttles += 1
                if first_429_at is None:
                    first_429_at = i
                print(f"  ⚠ THROTTLED (429) — rate limit hit!")
                md_lines.append(f"## Call {i} — ⚠ Throttled (429)")
                md_lines.append(f"> {short}")
                md_lines.append("")
                md_lines.append(f"```\n{msg[:300]}\n```")
                md_lines.append("")
            else:
                errors += 1
                print(f"  ✗ ERROR: {msg[:200]}")
                md_lines.append(f"## Call {i} — ✗ Error")
                md_lines.append(f"> {short}")
                md_lines.append("")
                md_lines.append(f"```\n{msg[:300]}\n```")
                md_lines.append("")

        if i < len(prompts) and args.delay > 0:
            time.sleep(args.delay)

    total_tokens = total_input + total_output
    print(
        f"\n{'=' * 60}\n"
        f"  Burst Summary — {user['display']}\n"
        f"{'=' * 60}\n"
        f"  Total calls  : {len(prompts)}\n"
        f"  Successful   : {successes}\n"
        f"  Throttled    : {throttles}\n"
        f"  Errors       : {errors}\n"
        f"  Tokens       : {total_input:,} in / {total_output:,} out / {total_tokens:,} total\n"
        f"  Est. cost    : ${total_cost:.6f}\n"
        f"  First 429 at : call #{first_429_at or 'N/A'}\n"
        f"  Output       : {out_file.name}\n"
        f"{'=' * 60}"
    )

    md_lines.append("---")
    md_lines.append("")
    md_lines.append("## Summary")
    md_lines.append("")
    md_lines.append("| Metric | Value |")
    md_lines.append("|--------|-------|")
    md_lines.append(f"| Total calls | {len(prompts)} |")
    md_lines.append(f"| Successful | {successes} |")
    md_lines.append(f"| Throttled (429) | {throttles} |")
    md_lines.append(f"| Errors | {errors} |")
    md_lines.append(f"| Input tokens | {total_input:,} |")
    md_lines.append(f"| Output tokens | {total_output:,} |")
    md_lines.append(f"| Total tokens | {total_tokens:,} |")
    md_lines.append(f"| Estimated cost | ${total_cost:.6f} |")
    md_lines.append(f"| First 429 at | call #{first_429_at or 'N/A'} |")
    md_lines.append("")

    out_file.write_text("\n".join(md_lines), encoding="utf-8")
    print(f"\n✓ Saved to {out_file}")


if __name__ == "__main__":
    main()
