"""
simulate_to_budget.py — Drive usage up to a target dollar budget per user.

All calls route through the APIM gateway so:
  • APIM enforces per-user TPM quotas  (throttles if limit exceeded)
  • Azure Monitor records tokens per deployment (visible in the React dashboard)
  • Dashboard cost estimate = (totalTokens / 1000) × costPerK  (same formula used here)

Cost model (mirrors frontend/src/components/Dashboard.tsx COST_PER_1K):
  gpt-5.4-mini-01  → matches "gpt-5"  → $3.75 / 1K tokens
  Kimi-K2.6-1      → no match         → $2.00 / 1K tokens (default)

At $1/user with both models, each user makes ~2 calls (1 GPT + 1 Kimi).

Run:
    python simulate_to_budget.py                      # $1/user, both models, all 4 users
    python simulate_to_budget.py --budget 5.0         # $5/user
    python simulate_to_budget.py --models gpt         # GPT deployment only
    python simulate_to_budget.py --models kimi        # Kimi only
    python simulate_to_budget.py --dry-run            # estimate calls needed, no API calls
    python simulate_to_budget.py --concurrency 2      # run 2 users at a time
"""

import argparse
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from dotenv import load_dotenv
from openai import AzureOpenAI

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

APIM_GATEWAY_URL = os.environ.get(
    "APIM_GATEWAY_URL",
    "https://foundry-observability2-apim.azure-api.net",
)
API_VERSION     = os.environ.get("OPENAI_API_VERSION", "2025-01-01-preview")
DEPLOYMENT_GPT  = os.environ.get("DEPLOYMENT_GPT",  "gpt-5.4-mini")
DEPLOYMENT_KIMI = os.environ.get("DEPLOYMENT_KIMI", "Kimi-K2.5")

# Same cost model as Dashboard.tsx COST_PER_1K  (dollars per 1K tokens)
COST_PER_1K: dict[str, float] = {
    "gpt-4o":       2.50,
    "gpt-4o-mini":  0.15,
    "gpt-4.1":      2.00,
    "gpt-4.1-mini": 0.10,
    "gpt-5":        3.75,
    "o3":           2.00,
    "o4-mini":      1.10,
    "_default":     2.00,
}


def cost_rate(deployment: str) -> float:
    """Return cost per 1K tokens for a deployment (mirrors getCost() in Dashboard.tsx)."""
    dep = deployment.lower()
    key = next((k for k in COST_PER_1K if k != "_default" and k in dep), "_default")
    return COST_PER_1K[key]


def estimate_cost(deployment: str, total_tokens: int) -> float:
    return (total_tokens / 1_000) * cost_rate(deployment)


# ── Rich prompts — designed to elicit long, token-heavy completions ───────────

GPT_SYSTEM = "You are a helpful cloud AI expert. Answer clearly and concisely in 2-3 sentences."

KIMI_SYSTEM = "You are a knowledgeable AI researcher. Answer clearly and concisely in 2-3 sentences."

# Short, direct questions — designed to produce brief completions (~100-150 tokens)
GPT_PROMPTS = [
    "What is the difference between REST and gRPC for AI API calls?",
    "How does Azure APIM enforce rate limits using policy XML?",
    "Explain token-based pricing for LLM APIs in one paragraph.",
    "What is RAG and when should you use it over fine-tuning?",
    "Name three ways to reduce LLM API costs in production.",
]

KIMI_PROMPTS = [
    "What is the key difference between attention mechanisms in GPT and BERT?",
    "Explain RLHF in two sentences.",
    "What are the main trade-offs of a mixture-of-experts model?",
    "How does chain-of-thought prompting improve LLM reasoning?",
    "What is the biggest challenge in deploying large language models at scale?",
]


# ── Users ─────────────────────────────────────────────────────────────────────

USERS = [
    {
        "name":    "Peter Parker",
        "key_env": "PETER_PARKER_KEY",
        "persona": "superhero / student",
    },
    {
        "name":    "Tonny Stark",
        "key_env": "TONNY_STARK_KEY",
        "persona": "superhero / architect",
    },
    {
        "name":    "Son Goku",
        "key_env": "SON_GOKU_KEY",
        "persona": "manga / warrior",
    },
    {
        "name":    "Monkey D. Luffy",
        "key_env": "MONKEY_D_LUFFY_KEY",
        "persona": "manga / adventurer",
    },
]


# ── Per-user state ────────────────────────────────────────────────────────────

@dataclass
class UserState:
    name: str
    tokens: dict[str, int] = field(default_factory=dict)   # dep → tokens
    calls:  dict[str, int] = field(default_factory=dict)   # dep → calls
    errors: int = 0
    throttles: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, dep: str, tokens: int) -> None:
        with self._lock:
            self.tokens[dep] = self.tokens.get(dep, 0) + tokens
            self.calls[dep]  = self.calls.get(dep, 0)  + 1

    @property
    def total_cost(self) -> float:
        return sum(estimate_cost(dep, tok) for dep, tok in self.tokens.items())

    @property
    def summary(self) -> str:
        parts = [f"  {dep}: {tok:,} tok ({self.calls[dep]} calls, ${estimate_cost(dep, tok):.3f})"
                 for dep, tok in self.tokens.items()]
        return "\n".join(parts) if parts else "  (no calls yet)"


# ── Core logic ────────────────────────────────────────────────────────────────

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


def run_user(
    user: dict,
    deployments: list[str],
    budget: float,
    delay: float,
    state: UserState,
    dry_run: bool,
) -> None:
    key = os.environ.get(user["key_env"], "")
    if not key:
        print(f"[{user['name']}] ⚠  {user['key_env']} not set — skipping")
        return

    client = build_client(key) if not dry_run else None

    # Interleave prompts from both deployments for balanced spread
    call_plan: list[tuple[str, str, str]] = []  # (deployment, system, prompt)
    gpt_prompts  = list(GPT_PROMPTS)
    kimi_prompts = list(KIMI_PROMPTS)

    dep_pool = deployments * 50  # enough iterations
    gpt_idx = kimi_idx = 0

    for dep in dep_pool:
        if dep == DEPLOYMENT_GPT:
            prompt = gpt_prompts[gpt_idx % len(gpt_prompts)]
            gpt_idx += 1
            call_plan.append((dep, GPT_SYSTEM, prompt))
        else:
            prompt = kimi_prompts[kimi_idx % len(kimi_prompts)]
            kimi_idx += 1
            call_plan.append((dep, KIMI_SYSTEM, prompt))

        # Estimate accumulated cost
        est_tokens_per_call = 200  # conservative pre-flight estimate
        est_cost = sum(
            estimate_cost(d, cnt * est_tokens_per_call)
            for d, cnt in {
                dep: sum(1 for p in call_plan if p[0] == dep)
                for dep in deployments
            }.items()
        )
        if est_cost >= budget:
            break

    if dry_run:
        gpt_calls  = sum(1 for p in call_plan if p[0] == DEPLOYMENT_GPT)
        kimi_calls = sum(1 for p in call_plan if p[0] == DEPLOYMENT_KIMI)
        print(f"\n[DRY RUN] {user['name']} — budget ${budget:.2f}")
        if DEPLOYMENT_GPT in deployments:
            print(f"  {DEPLOYMENT_GPT}: ~{gpt_calls} calls × ~200 tok = "
                  f"~{gpt_calls*200:,} tok ≈ ${estimate_cost(DEPLOYMENT_GPT, gpt_calls*200):.2f}")
        if DEPLOYMENT_KIMI in deployments:
            print(f"  {DEPLOYMENT_KIMI}: ~{kimi_calls} calls × ~200 tok = "
                  f"~{kimi_calls*200:,} tok ≈ ${estimate_cost(DEPLOYMENT_KIMI, kimi_calls*200):.2f}")
        print(f"  Total calls: {len(call_plan)}")
        return

    n = len(call_plan)
    print(f"\n{'─'*60}")
    print(f"  {user['name']} | budget ${budget:.2f} | {n} planned calls | {len(deployments)} model(s)")
    print(f"{'─'*60}")

    for i, (dep, system, prompt) in enumerate(call_plan, 1):
        cur_cost = state.total_cost
        if cur_cost >= budget:
            print(f"[{user['name']}] Budget reached (${cur_cost:.3f}) after {i-1} calls — stopping.")
            break

        print(f"[{user['name']}] {i}/{n} {dep[:20]:<20} cost so far ${cur_cost:.3f} / ${budget:.2f}")

        try:
            resp = client.chat.completions.create(  # type: ignore[union-attr]
                model=dep,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": prompt},
                ],
                max_completion_tokens=150,
                temperature=0.7,
            )
            usage = resp.usage
            total_tok = (usage.total_tokens if usage else 600)
            state.add(dep, total_tok)

        except Exception as exc:
            msg = str(exc)
            if "429" in msg:
                state.throttles += 1
                wait = 30
                print(f"[{user['name']}] ⚠  TPM throttle (429) — waiting {wait}s …")
                time.sleep(wait)
            else:
                state.errors += 1
                print(f"[{user['name']}] ✗  {exc}")

        if i < n and state.total_cost < budget:
            time.sleep(delay)

    final = state.total_cost
    print(f"\n✓ {user['name']} done — total calls: {sum(state.calls.values())} | "
          f"est. cost: ${final:.3f} | throttles: {state.throttles} | errors: {state.errors}")
    print(state.summary)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Simulate Foundry usage up to a target budget per user via APIM"
    )
    parser.add_argument(
        "--budget", type=float, default=1.0,
        help="Target spend in USD per user (default: 1.0)",
    )
    parser.add_argument(
        "--models", choices=["both", "gpt", "kimi"], default="both",
        help="Which deployed models to use (default: both)",
    )
    parser.add_argument(
        "--delay", type=float, default=1.0,
        help="Seconds between consecutive calls per user (default: 1.0)",
    )
    parser.add_argument(
        "--concurrency", type=int, default=4,
        help="Number of users to run in parallel (default: 4)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Estimate calls needed without making API calls",
    )
    args = parser.parse_args()

    if args.models == "gpt":
        deployments = [DEPLOYMENT_GPT]
    elif args.models == "kimi":
        deployments = [DEPLOYMENT_KIMI]
    else:
        deployments = [DEPLOYMENT_GPT, DEPLOYMENT_KIMI]

    print("=" * 60)
    print(" Foundry Usage Simulator — Budget Mode")
    print("=" * 60)
    print(f"  Budget per user : ${args.budget:.2f}")
    print(f"  Models          : {', '.join(deployments)}")
    print(f"  Users           : {len(USERS)}")
    print(f"  Concurrency     : {args.concurrency}")
    print(f"  APIM gateway    : {APIM_GATEWAY_URL}")
    for dep in deployments:
        print(f"  Cost rate       : {dep} → ${cost_rate(dep):.2f}/1K tokens")
    if args.dry_run:
        print("  *** DRY RUN — no API calls will be made ***")
    print("=" * 60)

    states = {u["name"]: UserState(name=u["name"]) for u in USERS}

    sem = threading.Semaphore(args.concurrency)

    def worker(user: dict) -> None:
        with sem:
            run_user(
                user=user,
                deployments=deployments,
                budget=args.budget,
                delay=args.delay,
                state=states[user["name"]],
                dry_run=args.dry_run,
            )

    threads = [threading.Thread(target=worker, args=(u,), daemon=True) for u in USERS]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    if args.dry_run:
        return

    print("\n" + "=" * 60)
    print(" Final Summary")
    print("=" * 60)
    total_cost = 0.0
    for name, s in states.items():
        c = s.total_cost
        total_cost += c
        bar_len = int(min(c / args.budget, 1.0) * 20)
        bar = "█" * bar_len + "░" * (20 - bar_len)
        pct = min(c / args.budget * 100, 100) if args.budget > 0 else 0
        print(f"  {name:<22} [{bar}] ${c:.3f} ({pct:.0f}% of ${args.budget:.2f})")
    print(f"\n  Grand total across all users: ${total_cost:.3f}")
    print("\n  Refresh the dashboard (1D / Hourly) to see usage metrics.")
    print("=" * 60)


if __name__ == "__main__":
    main()
