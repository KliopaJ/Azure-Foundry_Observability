# Usage Simulation Guide

Manually drive synthetic traffic through the APIM gateway to all 4 users across deployed Foundry models. Useful for testing the observability dashboard, verifying rate-limit enforcement, and generating realistic usage data.

---

## Prerequisites

The simulation uses the `usage-simulation/` virtual environment. All packages are already installed.

```bash
cd usage-simulation/
```

Verify the environment works:

```bash
.venv/bin/python -c "import openai; print('OK')"
```

Make sure `.env` is present (copy from `.env.example` if not):

```bash
cp .env.example .env   # then fill in your APIM subscription keys
```

Required variables:

| Variable | Description |
|---|---|
| `APIM_GATEWAY_URL` | APIM gateway URL (already set) |
| `PETER_PARKER_KEY` | APIM subscription key for Peter Parker |
| `TONNY_STARK_KEY` | APIM subscription key for Tonny Stark |
| `SON_GOKU_KEY` | APIM subscription key for Son Goku |
| `MONKEY_D_LUFFY_KEY` | APIM subscription key for Monkey D. Luffy |

---

## Budget-Based Simulation (`simulate_to_budget.py`)

Drives each user up to a target spend in USD across both deployed models. Stops each user as soon as their budget is hit.

**Default:** `$1.00 per user`, both models (`gpt-5.4-mini` + `Kimi-K2.5`), all 4 users in parallel.

### Cost model (same as the dashboard)

| Deployment | Matched rate | $/1K tokens |
|---|---|---|
| `gpt-5.4-mini` | `gpt-5` | $3.75 |
| `Kimi-K2.5` | default | $2.00 |

At `$1/user` with both models: each user makes **~2 API calls** (1 GPT + 1 Kimi).

### Basic usage

```bash
# Default: $1/user, both models, all 4 users concurrently
.venv/bin/python simulate_to_budget.py

# Preview without making API calls
.venv/bin/python simulate_to_budget.py --dry-run

# Higher budget
.venv/bin/python simulate_to_budget.py --budget 5.0

# GPT model only
.venv/bin/python simulate_to_budget.py --models gpt

# Kimi model only
.venv/bin/python simulate_to_budget.py --models kimi

# Run users sequentially instead of in parallel
.venv/bin/python simulate_to_budget.py --concurrency 1

# Add delay between each user's calls (seconds)
.venv/bin/python simulate_to_budget.py --delay 2.0
```

### All options

```
--budget FLOAT       Target USD per user (default: 1.0)
--models {both,gpt,kimi}  Which models to use (default: both)
--delay FLOAT        Seconds between calls per user (default: 1.0)
--concurrency INT    Parallel users (default: 4)
--dry-run            Estimate calls without hitting the API
```

### What it does

1. Each user calls the APIM gateway using their personal subscription key.
2. APIM enforces their TPM quota — calls exceeding the limit return HTTP 429 (automatically retried after 30 s).
3. Azure Monitor records tokens per deployment → visible in the **Dashboard** (1D / Hourly view).
4. The script tracks actual token counts from API responses and stops each user when their accumulated estimated cost reaches `--budget`.

### Expected output

```
============================================================
 Foundry Usage Simulator — Budget Mode
============================================================
  Budget per user : $1.00
  Models          : gpt-5.4-mini, Kimi-K2.5
  Users           : 4
  ...
──────────────────────────────────────────────────────────
  Peter Parker | budget $1.00 | 2 planned calls | 2 model(s)
──────────────────────────────────────────────────────────
[Peter Parker] 1/2 gpt-5.4-mini      cost so far $0.000 / $1.00
[Peter Parker] 2/2 Kimi-K2.5          cost so far $0.750 / $1.00
✓ Peter Parker done — total calls: 2 | est. cost: $1.150 | throttles: 0 | errors: 0

============================================================
 Final Summary
============================================================
  Peter Parker           [████████████████████] $1.150 (115% of $1.00)
  Tonny Stark            [████████████████████] $1.150 (115% of $1.00)
  ...
  Grand total across all users: $4.600

  Refresh the dashboard (1D / Hourly) to see usage metrics.
```

---

## Per-User Scripts

Each user also has a dedicated script for targeted testing:

```bash
.venv/bin/python peter_parker.py                          # 1 round on GPT
.venv/bin/python peter_parker.py --deployment Kimi-K2.5
.venv/bin/python peter_parker.py --rounds 3               # repeat 3×

.venv/bin/python tonny_stark.py
.venv/bin/python son_goku.py
.venv/bin/python monkey_d_luffy.py
```

## Run All Users (fixed rounds)

```bash
.venv/bin/python run_all.py                     # 1 round, GPT model
.venv/bin/python run_all.py --rounds 2          # 2× prompts per user
.venv/bin/python run_all.py --deployment Kimi-K2.5
```

---

## Viewing results in the dashboard

1. Open the React app at `http://localhost:8004`
2. Select the Foundry resource (`foundry-observability-resource1`)
3. Set time range to **1D** and granularity to **Hourly**
4. The **Token Usage Over Time** chart will show bars for each deployment
5. The **Users & Groups** section shows per-user request counts and estimated cost

> Azure Monitor ingestion typically has a 2–5 minute delay. Refresh the dashboard after the simulation completes.

---

## Single-Simulation Scripts

The `single-simulation/` folder contains standalone scripts for quick ad-hoc testing:

### `simulate_user.py`

Single-user simulation that makes API calls and writes a detailed markdown report.

```bash
cd usage-simulation/single-simulation/
../../.venv/bin/python simulate_user.py
```

### `burst_simulate.py`

Rapid-fire burst of API calls to trigger APIM 429 throttling. Useful for verifying rate-limit enforcement.

```bash
cd usage-simulation/single-simulation/
../../.venv/bin/python burst_simulate.py
```

Output files (markdown reports with timestamps) are saved in the same `single-simulation/` directory.
