# Overvix & Volatility Term Structure Terminal

A high-performance, real-time quantitative volatility terminal and interactive dashboard designed for professional options traders, volatility arbitrageurs, and equity index mean-reversion strategies. Powered natively by **Interactive Brokers (`ib-async`)**, **FastAPI**, **WebSockets**, and **Plotly.js**.

---

## Overview

The **Overvix Terminal** monitors the real-time pricing relationship between spot equities and implied volatility across multiple regimes and asset pairs (**SPX / VIX** and **NDX / VXN**). It identifies structural volatility dislocations, capitulation events, and curve inversions in real time.

```
+-----------------------------------------------------------------------------------------------+
|  OVERVIX & VOLATILITY TERM STRUCTURE TERMINAL                                                 |
|  [SPX 500: 7356.73 (-4.32%)]  [VIX: 27.59 (+10.98 pts)]  [VIX/VIX3M: 1.0210 (INVERTED)]       |
+-----------------------------------------------------------------------------------------------+
|  [Spot-Vol Regression & Overvix Trail]   |   [Volatility Term Structure (VIX / VIX3M)]        |
|  - 60D OLS Trendline & +2.0 pt Band      |   - 1D (1-min), 5D (5-min), 1Y (daily)             |
|  - Intraday Breadcrumb Trail & Beacon   |   - Contango (<0.90) vs Backwardation (>=1.00)      |
+------------------------------------------+----------------------------------------------------+
|  [Dynamic Correlation & Divergence]      |   [Tech Vol Premium (VXN - VIX)]                   |
|  - Rolling 30m Pearson Correlation       |   - VXN / VIX Spread & Ratio vs 1.28x Equilibrium  |
|  - Dual Overlay with Inverted Vol        |   - Nasdaq Outperformance / Panic Detection        |
+-----------------------------------------------------------------------------------------------+
```

---

## Key Capabilities & Quantitative Models

### 1. Spot-Vol OLS Regression & Overvix Residual Detection
- **Rolling 60-Day Baseline**: Computes an Ordinary Least Squares (OLS) regression between daily index percentage moves ($\Delta\text{Spot}\%$) and daily volatility point moves ($\Delta\text{Vol pts}$) over the preceding 60 completed trading sessions:
  $$\Delta\text{Vol} = \alpha + \beta \times \Delta\text{Spot}\% + \epsilon$$
- **Overvix / Over-VXN Residual**:
  $$\text{Residual} = \Delta\text{Vol}_{\text{actual}} - (\alpha + \beta \times \Delta\text{Spot}\%)$$
- **Capitulation Threshold**: When $\text{Residual} \ge +2.0\text{ pts}$ (SPX) or $+2.5\text{ pts}$ (NDX), implied volatility is statistically overpriced relative to market moves, signalling acute hedging panic and prime mean-reversion long setups.
- **Intraday Breadcrumb Trail**: Visualizes the path of the current trading session from the 09:30 ET opening bell to the current live price (or 16:00 ET close), with a high-visibility glowing beacon marker.

### 2. Volatility Term Structure Monitor (VIX / VIX3M) & Dynamic Stepped Timeframe Slider
- Tracks the ratio between 30-day front-month volatility (**VIX**) and 90-day medium-term volatility (**VIX3M**):
  $$\text{Term Structure Ratio} = \frac{\text{VIX}}{\text{VIX3M}}$$
- **Regimes**:
  - **Normal Contango ($\text{Ratio} < 0.90$)**: Standard upward-sloping volatility curve.
  - **Pre-Panic Flattening ($0.90 \le \text{Ratio} < 1.00$)**: Front-month hedging demand rising rapidly.
  - **Backwardation / Inversion ($\text{Ratio} \ge 1.00$)**: Systemic panic; front-month volatility trades at a premium to longer duration protection.
- **Dynamic Stepped Timeframe Slider (8 Granular Horizons)**:
  Both Card 2 (Term Structure) and Card 3 (Dynamic Correlation) feature an interactive stepped slider (`0` to `7`) supporting 8 distinct multi-timeframe horizons with tailor-made bar granularities:
  1. **`1D`**: Intraday 1-minute RTH bars (390 bars) with rolling 30-min Pearson correlation.
  2. **`5D`**: 1-Week 5-minute bars (~390 bars) with rolling 1-day Pearson correlation.
  3. **`1M`**: 1-Month 30-minute bars (~286 bars) for granular monthly OPEX and swing cycle analysis.
  4. **`3M`**: Quarterly 4-hour bars (~133 bars) **natively matched to the 90-day VIX3M contract tenor**.
  5. **`6M`**: Semi-Annual 4-hour bars (~257 bars) for multi-quarter volatility cycles.
  6. **`YTD`**: Year-to-Date daily bars from Jan 1 of active year for institutional benchmark performance.
  7. **`1Y`**: 1-Year macro daily bars (252 trading sessions) for annual baseline seasonality.
  8. **`MAX`**: Multi-Year 2-Year daily bars (500 trading sessions) for macro regime shifts and crisis comparisons.
- **🔗 Timeframe Synchronization Toggle**: Link sliders between Term Structure and Dynamic Correlation with a single click. Clickable tick labels, drag slider, or keyboard arrow keys for rapid inspection.

### 3. Dynamic Spot-Vol Correlation & Divergence Monitor
- Calculates rolling 30-minute Pearson correlation $\rho(\Delta\text{Spot}, \Delta\text{Vol})$.
- **Regimes**:
  - **Healthy Inverse ($\rho < -0.40$)**: Normal inverse spot-vol dynamics.
  - **Weakening ($-0.40 \le \rho < 0.00$)**: Spot-vol link degrading.
  - **Positive Decoupling ($\rho \ge 0.00$)**: Spot equities and volatility moving in tandem (extreme market stress or short-covering rallies).
- **Interactive Dual Overlay**: Plots minute-by-minute normalized trajectories of Spot % move and Vol point move, with a one-click toggle to invert the volatility axis for direct parallel visual comparison.
- **Recovery Anchor & Leader Diagnostic**:
  - Re-anchors baseline moves to any specific timestamp $t_0$ (e.g. market bottom or panic spike peak).
  - Quick presets: `[⚡ SPX Low]`, `[🔥 VIX High]`, `[🕒 Custom Time]`, or **direct 1-click on any bar on the chart**.
  - **Zero-Aligned Dual Y-Axes**: Dynamically computes mathematically synchronized axis bounds for left (Spot %) and right (Vol pts, upright or inverted) axes so that $0.0$ on both scales aligns at the **exact same vertical pixel height**. At anchor point $t_0$, both curves intersect and emerge from a single glowing origin marker $(t_0, 0)$.
  - **Recovery Leader Engine**: Automatically evaluates post-anchor moves and diagnoses whether implied volatility crushed first (**VOL CRUSH LEADING**) or equities rebounded with sticky vol (**EQUITIES LEADING**).
  - Live metric banner tracking elapsed recovery time, net asset moves, and lead/lag minutes.

### 4. Tech Volatility Premium (VXN - VIX & VXN / VIX)
- Real-time spread and ratio between Nasdaq volatility (**VXN**) and S&P volatility (**VIX**).
- Detects tech-led market panics when the spread expands beyond $+6.5\text{ pts}$ or ratio exceeds $1.35\text{x}$ (historical 95th percentile).

### 5. Master Confluence System
- Evaluates multi-factor market signals into actionable real-time regime tags:
  - **CAPITULATION DUAL ALERT**: Overvix Triggered ($\ge +2.0\text{ pts}$) **+** Vol Curve Inverted ($\ge 1.00$).
  - **OVERVIX ALERT**: Spot-Vol Shock ($\ge +2.0\text{ pts}$) in normal contango.
  - **TERM STRUCTURE INVERTED**: Backwardation without Spot-Vol dislocation.
  - **CURVE FLATTENING**: Pre-panic curve compression ($0.90 - 1.00$).
  - **NORMAL REGIME**: Contango and standard spot-vol pricing.

### 6. Historical Session Replay & Caching Engine
- Replay any historical trading session in 1-minute granularity using the global date picker or built-in presets (**2026-08-05 Global Vol Spike**, **2026-10-22 Panic Capitulation**, **2026-10-23 Vol Exhaustion Low**, **2026-10-26 Mean-Reversion Rip**).
- Automated local disk cache in `data/sessions/<YYYY-MM-DD>.json` for instant (0ms) offline replays.
- Add and persist custom notable date presets via the UI.

### 7. Multi-Asset SPX & NDX Switching
- Instant toggle between **SPX • VIX** and **NDX • VXN** across all dashboard cards, regressions, and correlation charts.

---

## Architecture & Data Flow

```
                      +-----------------------------+
                      |   Interactive Brokers TWS   |
                      |   or IB Gateway (Port 7496) |
                      +--------------+--------------+
                                     |
                                     | ib-async (native socket)
                                     v
+------------------------------------+---------------------------------------+
|  BACKEND: dashboard.py (FastAPI + asyncio)                                  |
|                                                                            |
|  - Pre-market / GTH Session Synchronization (VIX GTH vs SPX RTH)           |
|  - 60D OLS Regression Calculator (scipy.stats)                              |
|  - Intraday 1-min Bar Processor & Rolling Pearson Correlation (pandas)     |
|  - Session History Engine & Disk Cache (session_history.py)                |
|  - Live Sub-second Broadcaster (WebSocket: /ws/live)                       |
+------------------------------------+---------------------------------------+
                                     |
                                     | WebSocket JSON Stream / REST APIs
                                     v
+------------------------------------+---------------------------------------+
|  FRONTEND: Browser Terminal (Plotly.js + HTML5 / CSS)                      |
|                                                                            |
|  - Top Market Cards & Regime Confluence Banner                             |
|  - Spot-Vol Regression Chart with Live Breadcrumb Trail & Beacon           |
|  - Volatility Term Structure Monitor (1D / 5D / 1Y)                        |
|  - Dynamic Correlation & Normalized Overlay (with Inverted Scale Toggle)   |
|  - Historical Date Replay Selector & Config Modal                          |
+----------------------------------------------------------------------------+
```

---

## Prerequisites

### 1. Interactive Brokers Trader Workstation (TWS) or IB Gateway
- Ensure **TWS** or **IB Gateway** is running and logged in.
- Configure API settings in TWS (`File -> Global Configuration -> API -> Settings`):
  - **Enable ActiveX and Socket Clients**: Checked
  - **Socket port**: `7496` (for Live) or `7497` (for Paper)
  - **Allow connections from localhost only**: Checked (or add `127.0.0.1` to trusted IP addresses)
  - **Read-Only API**: Unchecked (optional, terminal only reads market data)

### 2. Market Data Subscriptions (IBKR)
To receive live streaming trades and daily historical bars, your IBKR account requires market data for US Indices:
- **CBOE Volatility Indices**: VIX, VIX3M, VXN
- **US Equities & Indices**: SPX, NDX

---

## Installation

1. **Clone or navigate to the repository directory**:
   ```bash
   cd "C:\Users\barla\Documents\Python Scripts\overvix"
   ```

2. **Activate the virtual environment**:
   ```powershell
   # Windows PowerShell
   .\.venv\Scripts\Activate.ps1
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

### Dependencies (`requirements.txt`)
- `ib-async >= 2.1.0`: Native asyncio-driven Interactive Brokers TWS/Gateway client.
- `fastAPI >= 0.110.0`: Async web framework for REST and WebSocket endpoints.
- `uvicorn[standard] >= 0.28.0`: High-performance ASGI web server.
- `websockets >= 12.0`: Real-time bidirectional streaming.
- `pandas >= 2.0.0`: High-speed time-series and rolling correlation math.
- `numpy >= 1.24.0` & `scipy >= 1.10.0`: Linear regression and numerical routines.
- `matplotlib >= 3.7.0`: Terminal utilities and color palettes.

---

## Running the Dashboard

### Standard Launch (Default Port 8000, IBKR Port 7496)
```bash
python dashboard.py
```
This automatically connects to IBKR on port `7496`, launches the server on `http://127.0.0.1:8000`, and opens your default browser.

### Headless / Background Mode (No Browser Popup)
```bash
python dashboard.py --no-browser
```

### CLI Arguments & Options
| Flag | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--port` | `int` | `7496` | IBKR TWS / Gateway socket port (`7496` Live, `7497` Paper, `4001`/`4002` Gateway). |
| `--web-port` | `int` | `8000` | Port for the terminal web interface and API. |
| `--client-id` | `int` | `20` | Unique API client ID for the IBKR connection. |
| `--no-browser` | `flag` | `False` | Disables automatic browser opening upon server start. |

#### Custom Examples
```bash
# Connect to TWS Paper Trading on port 7497
python dashboard.py --port 7497

# Connect to IB Gateway on port 4001 with custom web port 8080
python dashboard.py --port 4001 --web-port 8080 --client-id 42 --no-browser
```

---

## REST & WebSocket API Reference

The terminal exposes full programmatic endpoints for third-party tools, trading bots, and frontends:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` | `GET` | Serves the main terminal UI ([`static/index.html`](file:///c:/Users/barla/Documents/Python%20Scripts/overvix/static/index.html)). |
| `/api/bootstrap` | `GET` | Delivers initial market metrics, 60D regression points, 1D/5D/1Y term structure, and correlation data. |
| `/api/session?date=YYYY-MM-DD` | `GET` | Retrieves or fetches 1-minute historical replay for a specific trading session. |
| `/api/config` | `POST` | Dynamically updates thresholds (`spx_threshold`, `ndx_threshold`), `window` days, or `interval`. |
| `/api/notable-dates` | `GET` | Returns list of cached dates and notable market event presets. |
| `/api/notable-dates` | `POST` | Saves a user-defined custom notable date preset to [`data/notable_dates.json`](file:///c:/Users/barla/Documents/Python%20Scripts/overvix/data/notable_dates.json). |
| `/ws/live` | `WebSocket` | Real-time bidirectional WebSocket stream pushing live market updates at sub-second intervals. |

---

## Project Structure

```
overvix/
│
├── dashboard.py               # Main server, FastAPI application, IBKR engine, WebSocket broadcaster
├── session_history.py         # Historical session engine, 1-min bar assembly, local disk caching
├── requirements.txt           # Project dependencies
├── README.md                  # Comprehensive terminal documentation
│
├── data/
│   ├── notable_dates.json     # Saved notable historical session presets
│   └── sessions/              # Cached 1-minute intraday session JSON files
│       ├── 2026-08-05.json
│       ├── 2026-10-22.json
│       └── ...
│
├── static/
│   ├── index.html             # Terminal web UI markup and layout
│   ├── dashboard.js           # Frontend client, Plotly.js charts, WebSocket listener, audio alerts
│   └── styles.css             # Dark financial terminal styling
│
├── scratch/                   # Test scripts, baseline verification routines
└── test_session_history.py    # Unit verification for historical session fetcher and cache
```

---

## Mathematical Formulations

### 1. Spot-Vol Slope and Overvix Residual
Given $N$ historical trading days of percent changes $x_i = \Delta\text{SPX}_i\%$ and point changes $y_i = \Delta\text{VIX}_i$:
$$\beta = \frac{\sum_{i=1}^N (x_i - \bar{x})(y_i - \bar{y})}{\sum_{i=1}^N (x_i - \bar{x})^2}, \quad \alpha = \bar{y} - \beta \bar{x}$$

$$\text{Expected } \Delta\text{VIX} = \alpha + \beta \times \Delta\text{SPX}_{\text{curr}}\%$$

$$\text{Overvix Residual} = \Delta\text{VIX}_{\text{curr}} - \text{Expected } \Delta\text{VIX}$$

$$\text{Overvix Alert Triggered} \iff \text{Residual} \ge 2.0\text{ pts}$$

### 2. Rolling Pearson Correlation
For a rolling window of $W = 30$ one-minute returns:
$$\rho = \frac{\sum (r_{\text{spx}} - \bar{r}_{\text{spx}})(\Delta\text{vix} - \overline{\Delta\text{vix}})}{\sqrt{\sum (r_{\text{spx}} - \bar{r}_{\text{spx}})^2 \sum (\Delta\text{vix} - \overline{\Delta\text{vix}})^2}}$$

---

## License & Disclaimer

This software is for institutional research, quantitative analysis, and educational purposes only. Market trading involves substantial risk of loss. Past performance and statistical regression models do not guarantee future results.
