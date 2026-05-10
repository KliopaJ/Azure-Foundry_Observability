"""
simulate_user.py — Single-user APIM usage simulation.

Sends prompts through the APIM gateway as a specific user so you can test
TPM rate limits and budget changes in real-time.

Each call prints the full response to the console and appends it to a
markdown file: simulate_user--reply-<YYYY-MM-DD_HH-MM-SS>.md

Usage:
    python simulate_user.py --user peter-parker
    python simulate_user.py --user tonny-stark --deployment DeepSeek-V3.2
    python simulate_user.py --user son-goku --deployment Llama-4-Maverick-17B-128E-Instruct-FP8
    python simulate_user.py --user peter-parker --deployment gpt-5.3-codex
    python simulate_user.py --user son-goku --rounds 3
    python simulate_user.py --user monkey-d-luffy --prompt "Explain Kubernetes"
    python simulate_user.py --user peter-parker --delay 0.5 --rounds 5
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from openai import AzureOpenAI

# Load .env from project root and usage-simulation dir
_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_root / ".env")
load_dotenv(_root / "usage-simulation" / ".env")

# ── APIM config ──────────────────────────────────────────────────────────────

APIM_GATEWAY_URL = os.environ.get(
    "APIM_GATEWAY_URL",
    "https://foundry-observability2-apim.azure-api.net",
)
API_VERSION    = os.environ.get("OPENAI_API_VERSION", "2025-01-01-preview")
DEPLOYMENT_GPT = os.environ.get("DEPLOYMENT_GPT", "gpt-5.4-mini")
DEPLOYMENT_KIMI = os.environ.get("DEPLOYMENT_KIMI", "Kimi-K2.5")
DEPLOYMENT_DEEPSEEK = "DeepSeek-V3.2"
DEPLOYMENT_LLAMA = "Llama-4-Maverick-17B-128E-Instruct-FP8"
DEPLOYMENT_CODEX = "gpt-5.3-codex"


# ── User registry ───────────────────────────────────────────────────────────

USERS = {
    "peter-parker": {
        "display": "Peter Parker",
        "key_env": "PETER_PARKER_KEY",
        "group": "superheroes",
        "system": (
            "You are a helpful mentor for a curious college student who loves "
            "technology, science, and problem-solving. Keep answers concise and encouraging."
        ),
        "prompts": [
            "Can you explain how REST APIs work in simple terms?",
            "What's the difference between machine learning and traditional programming?",
            "How does HTTPS keep my data safe when I browse the web?",
            "What is Docker and why do developers use it?",
            "Give me a beginner project idea that uses Python and an API.",
        ],
    },
    "tonny-stark": {
        "display": "Tonny Stark",
        "key_env": "TONNY_STARK_KEY",
        "group": "superheroes",
        "system": (
            "You are an expert AI assistant for a senior cloud architect and engineer. "
            "Provide technically deep, precise answers. Skip basic explanations."
        ),
        "prompts": [
            "How should I design a multi-tenant APIM gateway with per-customer TPM quotas for Azure AI Foundry?",
            "Compare observability strategies for LLM workloads: Azure Monitor vs OpenTelemetry.",
            "What are the security implications of managed identities vs APIM subscription keys for AI model access?",
            "Design a circuit breaker pattern for an LLM gateway that gracefully degrades under throttling.",
            "Trade-offs between synchronous and asynchronous API patterns in high-throughput AI inference pipelines?",
        ],
    },
    "son-goku": {
        "display": "Son Goku",
        "key_env": "SON_GOKU_KEY",
        "group": "manga",
        "system": (
            "You are an enthusiastic and energetic coach who loves challenges. "
            "Frame technical answers in terms of training, power levels, and pushing limits."
        ),
        "prompts": [
            "How do I make my Python code run as fast as possible?",
            "What's the strongest architecture for serving thousands of AI requests per second?",
            "How do I train a machine learning model to get the best possible accuracy?",
            "How can I power up my app to handle sudden traffic spikes without breaking?",
            "What is the fastest way to process large datasets — compare pandas, polars, and DuckDB.",
        ],
    },
    "monkey-d-luffy": {
        "display": "Monkey D. Luffy",
        "key_env": "MONKEY_D_LUFFY_KEY",
        "group": "manga",
        "system": (
            "You are an adventurous guide who believes anyone can achieve anything with courage. "
            "Frame technical answers as quests, adventures, and treasures to discover."
        ),
        "prompts": [
            "What's the adventure path to becoming a cloud engineer?",
            "What are the most exciting new AI features in Azure I should explore?",
            "How do I build a team (microservices crew) where each member has a unique power?",
            "What's the most valuable skill a developer can have in 2026?",
            "How do I navigate a complex distributed system to find hidden problems?",
        ],
    },
}

# ── Pricing (mirrors Settings.tsx MODEL_PRICING) ────────────────────────────

PRICING = {
    "gpt-5.4-mini": (0.75, 4.50),
    "gpt-5.4-nano": (0.20, 1.25),
    "gpt-5.4":      (2.50, 15.00),
    "gpt-5-mini":   (0.25, 2.00),
    "gpt-5-nano":   (0.05, 0.40),
    "gpt-5":        (1.25, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1":      (2.00, 8.00),
    "gpt-4o-mini":  (0.15, 0.60),
    "gpt-4o":       (2.50, 10.00),
    "o4-mini":      (1.10, 4.40),
    "o3-mini":      (1.10, 4.40),
    "o3":           (2.00, 8.00),
    "o1-mini":      (1.10, 4.40),
    "o1":           (15.00, 60.00),
    "deepseek-v3":  (0.30, 0.88),
    "llama-4-maverick": (0.50, 1.50),
    "gpt-5.3-codex": (2.50, 10.00),
}
DEFAULT_PRICING = (2.00, 8.00)  # $/1M tokens (input, output)


def get_pricing(deployment: str) -> tuple[float, float]:
    d = deployment.lower()
    for key, prices in PRICING.items():
        if key in d:
            return prices
    return DEFAULT_PRICING


def estimate_cost(deployment: str, input_tokens: int, output_tokens: int) -> float:
    inp_rate, out_rate = get_pricing(deployment)
    return (input_tokens / 1_000_000) * inp_rate + (output_tokens / 1_000_000) * out_rate


# ── Core ─────────────────────────────────────────────────────────────────────

def build_client(subscription_key: str) -> AzureOpenAI:
    return AzureOpenAI(
        azure_endpoint=APIM_GATEWAY_URL,
        api_key=subscription_key,
        api_version=API_VERSION,
        default_headers={
            "api-key": subscription_key,
            "Ocp-Apim-Subscription-Key": subscription_key,
        },
        max_retries=0,
        timeout=90,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Single-user APIM usage simulation",
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
        "--prompt", type=str, default=None,
        help="Custom prompt (overrides built-in prompts)",
    )
    parser.add_argument(
        "--rounds", type=int, default=1,
        help="Number of prompts to send (default: 1)",
    )
    parser.add_argument(
        "--delay", type=float, default=1.5,
        help="Seconds between consecutive calls (default: 1.5)",
    )
    args = parser.parse_args()

    user = USERS[args.user]
    key = os.environ.get(user["key_env"], "")
    if not key:
        print(f"ERROR: Environment variable {user['key_env']} is not set.")
        sys.exit(1)

    # Build prompt list
    if args.prompt:
        prompts = [args.prompt] * args.rounds
    else:
        base = user["prompts"]
        prompts = (base * ((args.rounds // len(base)) + 1))[:args.rounds]

    client = build_client(key)
    now = datetime.now().astimezone()  # local timezone
    timestamp = now.strftime("%Y-%m-%d_%H-%M-%S")
    script_name = Path(__file__).stem
    out_file = Path(__file__).resolve().parent / f"{script_name}--reply-{timestamp}.md"

    inp_rate, out_rate = get_pricing(args.deployment)

    # ── Header ───────────────────────────────────────────────────────────
    header = (
        f"{'=' * 60}\n"
        f"  User       : {user['display']} ({args.user})\n"
        f"  Group      : {user['group']}\n"
        f"  Deployment : {args.deployment}\n"
        f"  Gateway    : {APIM_GATEWAY_URL}\n"
        f"  APIM key   : ...{key[-6:]}\n"
        f"  Pricing    : ${inp_rate}/1M input · ${out_rate}/1M output\n"
        f"  Prompts    : {len(prompts)}\n"
        f"  Delay      : {args.delay}s\n"
        f"  Output     : {out_file.name}\n"
        f"{'=' * 60}"
    )
    print(header)

    # ── Markdown preamble ────────────────────────────────────────────────
    md_lines: list[str] = [
        f"# Simulation Reply — {user['display']}",
        "",
        "| Field | Value |",
        "|-------|-------|",
        f"| User | {user['display']} (`{args.user}`) |",
        f"| Group | {user['group']} |",
        f"| Deployment | `{args.deployment}` |",
        f"| Pricing | ${inp_rate}/1M input · ${out_rate}/1M output |",
        f"| Timestamp | {now.strftime('%Y-%m-%d %H:%M:%S %Z')} |",
        f"| Gateway | `{APIM_GATEWAY_URL}` |",
        "",
        "---",
        "",
    ]

    # ── Run calls ────────────────────────────────────────────────────────
    total_input = 0
    total_output = 0
    total_cost = 0.0
    throttles = 0
    errors = 0
    results: list[dict] = []

    for i, prompt in enumerate(prompts, 1):
        print(f"\n[{i}/{len(prompts)}] {prompt}")
        md_lines.append(f"## Prompt {i}")
        md_lines.append("")
        md_lines.append(f"> {prompt}")
        md_lines.append("")

        try:
            resp = client.chat.completions.create(
                model=args.deployment,
                messages=[
                    {"role": "system", "content": user["system"]},
                    {"role": "user", "content": prompt},
                ],
                max_completion_tokens=2048,
                temperature=0.8,
            )
            reply = resp.choices[0].message.content or ""
            usage = resp.usage
            inp_tok = usage.prompt_tokens if usage else 0
            out_tok = usage.completion_tokens if usage else 0
            tot_tok = (usage.total_tokens if usage else 0)
            cost = estimate_cost(args.deployment, inp_tok, out_tok)

            total_input += inp_tok
            total_output += out_tok
            total_cost += cost

            results.append({
                "prompt": prompt,
                "reply": reply,
                "input_tokens": inp_tok,
                "output_tokens": out_tok,
                "cost": cost,
                "status": "ok",
            })

            # Console
            print(f"\n{reply}")
            print(f"\n  ── tokens: {inp_tok} in / {out_tok} out / {tot_tok} total · ${cost:.6f}")

            # Markdown
            md_lines.append("### Response")
            md_lines.append("")
            md_lines.append(reply)
            md_lines.append("")
            md_lines.append(
                f"*Tokens: {inp_tok} input / {out_tok} output / {tot_tok} total · "
                f"Cost: ${cost:.6f}*"
            )
            md_lines.append("")
            md_lines.append("---")
            md_lines.append("")

        except Exception as exc:
            msg = str(exc)
            if "429" in msg:
                throttles += 1
                status_msg = "⚠ THROTTLED (429) — APIM rate limit enforced"
                print(f"\n  {status_msg}")
                results.append({"prompt": prompt, "status": "throttled", "error": msg})
                md_lines.append(f"### Response")
                md_lines.append("")
                md_lines.append(f"**{status_msg}**")
                md_lines.append("")
                md_lines.append(f"```\n{msg[:500]}\n```")
                md_lines.append("")
                md_lines.append("---")
                md_lines.append("")
            else:
                errors += 1
                print(f"\n  ERROR: {msg[:300]}")
                results.append({"prompt": prompt, "status": "error", "error": msg})
                md_lines.append(f"### Response")
                md_lines.append("")
                md_lines.append(f"**ERROR:** `{msg[:300]}`")
                md_lines.append("")
                md_lines.append("---")
                md_lines.append("")

        if i < len(prompts):
            time.sleep(args.delay)

    # ── Summary ──────────────────────────────────────────────────────────
    summary = (
        f"\n{'=' * 60}\n"
        f"  Summary — {user['display']}\n"
        f"{'=' * 60}\n"
        f"  Calls      : {len(prompts)}\n"
        f"  Successful : {len(prompts) - throttles - errors}\n"
        f"  Throttled  : {throttles}\n"
        f"  Errors     : {errors}\n"
        f"  Tokens     : {total_input} input / {total_output} output / {total_input + total_output} total\n"
        f"  Est. cost  : ${total_cost:.6f}\n"
        f"  Output file: {out_file.name}\n"
        f"{'=' * 60}"
    )
    print(summary)

    # Markdown summary
    md_lines.append("## Summary")
    md_lines.append("")
    md_lines.append("| Metric | Value |")
    md_lines.append("|--------|-------|")
    md_lines.append(f"| Calls | {len(prompts)} |")
    md_lines.append(f"| Successful | {len(prompts) - throttles - errors} |")
    md_lines.append(f"| Throttled (429) | {throttles} |")
    md_lines.append(f"| Errors | {errors} |")
    md_lines.append(f"| Input tokens | {total_input:,} |")
    md_lines.append(f"| Output tokens | {total_output:,} |")
    md_lines.append(f"| Total tokens | {total_input + total_output:,} |")
    md_lines.append(f"| Estimated cost | ${total_cost:.6f} |")
    md_lines.append("")

    # Write markdown file
    out_file.write_text("\n".join(md_lines), encoding="utf-8")
    print(f"\n✓ Saved to {out_file}")


if __name__ == "__main__":
    main()
