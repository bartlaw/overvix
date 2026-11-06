r"""
Overvix Points Monitor with Interactive Brokers (IBKR)
======================================================
Calculates Spot-Vol regression between SPX % change and VIX absolute point move,
and monitors for Overvix signals (+2.0 points above regression line) in real time
using 100% native Interactive Brokers (TWS / IB Gateway) data:
  - Historical baseline: IBKR daily bars (reqHistoricalData)
  - Live data: IBKR streaming market data (reqMktData)

Requirements:
    pip install ib-async pandas numpy scipy matplotlib

Usage:
    .\.venv\Scripts\python.exe overvix_points_ibkr.py
    .\.venv\Scripts\python.exe overvix_points_ibkr.py --port 7496
    .\.venv\Scripts\python.exe overvix_points_ibkr.py --once
    .\.venv\Scripts\python.exe overvix_points_ibkr.py --once --no-plot
"""

import sys
import time
import math
import argparse
import asyncio
import warnings

warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

# Ensure asyncio event loop exists in Python 3.12+ / 3.14+ / 3.15+
try:
    loop = asyncio.get_event_loop()
except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

# IBKR library import: prefer ib_async (modernized), fallback to ib_insync
try:
    from ib_async import IB, Index, util
except ImportError:
    try:
        from ib_insync import IB, Index, util
    except ImportError:
        IB = None
        Index = None
        util = None

# ==============================================================================
# CONFIGURATION & SETTINGS
# ==============================================================================
DEFAULT_HOST = '127.0.0.1'
DEFAULT_PORT = 7496          # 7496: TWS Live, 7497: TWS Paper, 4001: Gateway Live, 4002: Gateway Paper
DEFAULT_CLIENT_ID = 10
WINDOW_DAYS = 60             # Rolling historical window (trading sessions)
OVERVIX_PTS_THRESHOLD = 2.0  # Volland Point-Based threshold (+2.0 pts above trendline)
UPDATE_INTERVAL = 1.0        # Seconds between live chart refreshes
COMMON_PORTS = [7496, 7497, 4001, 4002]


# ==============================================================================
# IBKR CONNECTION HELPERS
# ==============================================================================
def connect_ibkr(host=DEFAULT_HOST, port=DEFAULT_PORT, client_id=DEFAULT_CLIENT_ID):
    """
    Connect to TWS or IB Gateway with auto-fallback across standard ports.
    """
    if IB is None:
        raise ImportError(
            "\n" + "=" * 65 + "\n"
            "MISSING DEPENDENCY: Neither 'ib-async' nor 'ib_insync' is installed.\n"
            "Please install via: pip install ib-async\n"
            "=" * 65 + "\n"
        )

    ib = IB()
    ports_to_try = [port] + [p for p in COMMON_PORTS if p != port]

    connected = False
    for p in ports_to_try:
        try:
            print(f"[IBKR] Attempting connection to {host}:{p} (ClientId: {client_id})...", flush=True)
            ib.connect(host, p, clientId=client_id, timeout=3)
            connected = True
            print(f" Connected successfully to IBKR on port {p}!\n", flush=True)
            break
        except Exception as e:
            print(f"  Could not connect on port {p}: {e}", flush=True)

    if not connected:
        raise ConnectionError(
            f"\nFailed to connect to IBKR at {host} on ports {ports_to_try}.\n"
            "Ensure TWS or IB Gateway is running and API connections are enabled:\n"
            "  1. In TWS / Gateway: Edit -> Global Configuration -> API -> Settings\n"
            "  2. Check 'Enable ActiveX and Socket Clients'\n"
            "  3. Uncheck 'Read-Only API' (optional, read-only is fine for market data)\n"
            "  4. Verify Socket Port matches (7496 for live, 7497 for paper, 4001/4002 for gateway)"
        )

    # Market Data Type 3 = Delayed-Streaming (serves real-time if subscribed,
    # or delayed streaming without throwing error 354 if un-subscribed)
    ib.reqMarketDataType(3)
    return ib


# ==============================================================================
# DATA RETRIEVAL (100% NATIVE IBKR)
# ==============================================================================
def fetch_historical_ibkr(ib, spx_contract, vix_contract, window=WINDOW_DAYS):
    """
    Fetch historical daily bars directly from IBKR for SPX and VIX.
    """
    duration = f"{int(max(window * 2, 120))} D"
    print(f"[IBKR] Requesting historical daily bars ({duration}) for SPX & VIX...", flush=True)

    spx_bars = ib.reqHistoricalData(
        spx_contract,
        endDateTime='',
        durationStr=duration,
        barSizeSetting='1 day',
        whatToShow='TRADES',
        useRTH=True,
        formatDate=1
    )
    vix_bars = ib.reqHistoricalData(
        vix_contract,
        endDateTime='',
        durationStr=duration,
        barSizeSetting='1 day',
        whatToShow='TRADES',
        useRTH=True,
        formatDate=1
    )

    if not spx_bars or not vix_bars:
        raise RuntimeError(
            "IBKR returned empty historical bars for SPX or VIX.\n"
            "Ensure market data permissions for CBOE Indices are active in TWS/Gateway."
        )

    df_spx = util.df(spx_bars).set_index('date')['close'].rename('spx_close')
    df_vix = util.df(vix_bars).set_index('date')['close'].rename('vix_close')

    df = pd.concat([df_spx, df_vix], axis=1).dropna()
    if len(df) < window:
        raise RuntimeError(
            f"IBKR returned only {len(df)} overlapping daily bars, but {window} are required for the window.\n"
            f"Try decreasing --window or increasing historical request duration."
        )

    print(f" Fetched {len(df)} historical daily bars directly from IBKR.\n", flush=True)
    return df


def prepare_baseline_data(df_history, window=WINDOW_DAYS):
    """
    Calculate SPX % change and VIX absolute point change for the historical window.
    """
    data = pd.DataFrame()
    data['spx_pct'] = df_history['spx_close'].pct_change() * 100.0
    data['vix_pt']  = df_history['vix_close'].diff()
    data = data.dropna()

    # Retain the most recent `window` closed days for regression baseline
    recent = data.iloc[-window:].copy()

    # The most recent closed day and the day before it
    latest_spx = float(df_history['spx_close'].iloc[-1])
    latest_vix = float(df_history['vix_close'].iloc[-1])
    prior_spx  = float(df_history['spx_close'].iloc[-2]) if len(df_history) > 1 else latest_spx
    prior_vix  = float(df_history['vix_close'].iloc[-2]) if len(df_history) > 1 else latest_vix

    # Last completed session's moves
    last_session_spx_pct = float(recent['spx_pct'].iloc[-1])
    last_session_vix_pt  = float(recent['vix_pt'].iloc[-1])

    return recent, latest_spx, latest_vix, prior_spx, prior_vix, last_session_spx_pct, last_session_vix_pt


def get_current_price(ticker, fallback_price=None):
    """
    Extract best available current price from an IBKR Ticker object.
    Prefers live trades (last), then marketPrice(), then bid/ask midpoint, then close.
    """
    if ticker.last is not None and not math.isnan(ticker.last) and ticker.last > 0:
        return ticker.last, "LIVE LAST"

    mkt = ticker.marketPrice()
    if mkt is not None and not math.isnan(mkt) and mkt > 0:
        return mkt, "LIVE MKT"

    if ticker.bid is not None and ticker.ask is not None:
        if not math.isnan(ticker.bid) and not math.isnan(ticker.ask) and ticker.bid > 0 and ticker.ask > 0:
            return (ticker.bid + ticker.ask) / 2.0, "LIVE MID"

    if ticker.close is not None and not math.isnan(ticker.close) and ticker.close > 0:
        return ticker.close, "CLOSE"

    return fallback_price, "HIST"


# ==============================================================================
# MAIN APPLICATION
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Live Overvix Points Monitor via Interactive Brokers (100% IBKR)")
    parser.add_argument('--host', default=DEFAULT_HOST, help=f"IBKR TWS/Gateway host (default: {DEFAULT_HOST})")
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help=f"IBKR socket port (default: {DEFAULT_PORT})")
    parser.add_argument('--client-id', type=int, default=DEFAULT_CLIENT_ID, help=f"API Client ID (default: {DEFAULT_CLIENT_ID})")
    parser.add_argument('--window', type=int, default=WINDOW_DAYS, help=f"Rolling window size in days (default: {WINDOW_DAYS})")
    parser.add_argument('--threshold', type=float, default=OVERVIX_PTS_THRESHOLD, help=f"Overvix threshold in points (default: {OVERVIX_PTS_THRESHOLD})")
    parser.add_argument('--interval', type=float, default=UPDATE_INTERVAL, help=f"Refresh interval in seconds (default: {UPDATE_INTERVAL})")
    parser.add_argument('--once', action='store_true', help="Single snapshot mode (no live streaming loop)")
    parser.add_argument('--no-plot', action='store_true', help="Skip opening GUI plot window (console metrics only)")
    args = parser.parse_args()

    # 1. Connect to IBKR
    ib = connect_ibkr(host=args.host, port=args.port, client_id=args.client_id)

    # 2. Define Index Contracts
    spx_contract = Index('SPX', 'CBOE', 'USD')
    vix_contract = Index('VIX', 'CBOE', 'USD')

    print("[IBKR] Qualifying SPX and VIX contracts...", flush=True)
    ib.qualifyContracts(spx_contract, vix_contract)
    print(f" SPX Contract: conId={spx_contract.conId}, symbol={spx_contract.symbol}, exchange={spx_contract.exchange}", flush=True)
    print(f" VIX Contract: conId={vix_contract.conId}, symbol={vix_contract.symbol}, exchange={vix_contract.exchange}\n", flush=True)

    # 3. Get Historical Baseline Data (Directly from IBKR)
    df_history = fetch_historical_ibkr(ib, spx_contract, vix_contract, window=args.window)

    (recent_data,
     latest_spx, latest_vix,
     prior_spx, prior_vix,
     last_sess_x, last_sess_y) = prepare_baseline_data(df_history, window=args.window)

    x_hist = recent_data['spx_pct'].values
    y_hist = recent_data['vix_pt'].values

    # 4. Fit Baseline OLS Regression
    slope, intercept, r_value, p_value, std_err = stats.linregress(x_hist, y_hist)
    r_squared = r_value ** 2
    vol_slope = 1.0 / slope if slope != 0 else np.nan

    print("=" * 65, flush=True)
    print(f"SPOT-VOL BASELINE MODEL ({args.window}-Day Rolling Window from IBKR)", flush=True)
    print(f"  R²:              {r_squared:.4f}", flush=True)
    print(f"  Slope:           {slope:.4f}", flush=True)
    print(f"  Vol Slope:       {vol_slope:.4f}", flush=True)
    print(f"  Intercept:       {intercept:.4f}", flush=True)
    print(f"  SPX Reference:   {latest_spx:.2f}", flush=True)
    print(f"  VIX Reference:   {latest_vix:.2f}", flush=True)
    print(f"  Overvix Target:  +{args.threshold:.1f} pts above expected line", flush=True)
    print("=" * 65 + "\n", flush=True)

    # 5. Subscribe to Live Market Data
    print("[IBKR] Subscribing to live streaming market data for SPX & VIX...", flush=True)
    spx_ticker = ib.reqMktData(spx_contract, '', False, False)
    vix_ticker = ib.reqMktData(vix_contract, '', False, False)

    # Allow a moment for initial market data ticks
    print(" Waiting for initial market data...", flush=True)
    for _ in range(10):
        ib.sleep(0.2)
        spx_p, _ = get_current_price(spx_ticker, latest_spx)
        vix_p, _ = get_current_price(vix_ticker, latest_vix)
        if spx_p is not None and vix_p is not None:
            break

    # Setup Plot if not headless
    fig, ax = None, None
    live_scatter = None
    live_annotation = None

    if not args.no_plot:
        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(12, 7))
        try:
            fig.canvas.manager.set_window_title("Overvix Points Monitor — IBKR Live Stream")
        except Exception:
            pass

        # Historical points from IBKR
        ax.scatter(x_hist[:-1], y_hist[:-1], color='#E6D385', s=26, alpha=0.75, label='Spot-Vol Points (IBKR History)')

        # Trendline & Overvix Band
        x_min = min(x_hist.min(), -3.0) - 0.5
        x_max = max(x_hist.max(), 3.0) + 0.5
        x_grid = np.linspace(x_min, x_max, 250)
        y_trend = intercept + slope * x_grid
        y_overvix = y_trend + args.threshold

        ax.plot(x_grid, y_trend, color='#C5BF85', linewidth=1.8, label='Trendline (Expected)')
        ax.plot(x_grid, y_overvix, color='#FF5370', linestyle='--', linewidth=1.5,
                label=f'Overvix Threshold (+{args.threshold:.1f} pts)')
        ax.fill_between(x_grid, y_overvix, y_overvix + 2.5, color='#FF5370', alpha=0.10, label='Overvix Zone')

        # Reference axes and styling
        ax.axhline(0, color='#3B4254', linestyle='-', linewidth=0.8)
        ax.axvline(0, color='#3B4254', linestyle='-', linewidth=0.8)
        ax.grid(True, color='#1E2230', linestyle='-', linewidth=0.7)
        ax.set_xlabel('SPX % Change', color='#A2ACCA', fontsize=10)
        ax.set_ylabel('VIX Point Change', color='#A2ACCA', fontsize=10)

        # Initial live point
        live_scatter = ax.scatter([last_sess_x], [last_sess_y], color='#00E5FF', s=70, zorder=6, label='Current Point')

        # Annotation
        live_annotation = ax.annotate(
            "Connecting...",
            xy=(last_sess_x, last_sess_y),
            xytext=(last_sess_x + 0.15, last_sess_y + 0.4),
            arrowprops=dict(facecolor='#00E5FF', edgecolor='#00E5FF', arrowstyle='->', lw=1.2),
            fontsize=9,
            fontweight='bold',
            color='#00E5FF'
        )

        ax.legend(loc='upper right', frameon=False, ncol=2)
        plt.tight_layout()

        # Window close listener
        is_running = True
        def on_close(event):
            nonlocal is_running
            is_running = False
            print("\n[UI] Chart window closed by user.", flush=True)

        fig.canvas.mpl_connect('close_event', on_close)
        plt.ion()
        plt.show()
    else:
        is_running = True

    # 6. Live Monitoring Loop
    print("[Live Monitor] Running live stream. Press Ctrl+C in terminal or close window to exit.\n", flush=True)
    last_print_time = 0

    try:
        while is_running:
            ib.sleep(args.interval)

            spx_curr, spx_src = get_current_price(spx_ticker, latest_spx)
            vix_curr, vix_src = get_current_price(vix_ticker, latest_vix)

            # Determine whether live trading is active vs market closed
            is_live_trading = ("LIVE" in spx_src or "LIVE" in vix_src)

            if is_live_trading:
                # Active market: compare live price vs yesterday's closing price
                spx_base = latest_spx
                vix_base = latest_vix
                curr_x = ((spx_curr - spx_base) / spx_base) * 100.0
                curr_y = vix_curr - vix_base
                mode_tag = "LIVE TRADING"
            else:
                # Market closed: display the latest completed session's official result
                curr_x = last_sess_x
                curr_y = last_sess_y
                spx_curr = latest_spx
                vix_curr = latest_vix
                mode_tag = "LATEST SESSION (CLOSED)"

            # Overvix Calculations
            curr_expected = intercept + slope * curr_x
            curr_residual_pts = curr_y - curr_expected
            is_overvixed = curr_residual_pts >= args.threshold

            curr_color = '#FF1744' if is_overvixed else '#00E5FF'
            status_text = "OVERVIX SIGNAL" if is_overvixed else "No Signal"
            badge = "🚨 OVERVIX TRIGGERED" if is_overvixed else "⚪ NORMAL REGIME"

            # Update Plot
            if ax is not None and fig is not None:
                live_scatter.set_offsets(np.c_[[curr_x], [curr_y]])
                live_scatter.set_facecolor(curr_color)
                live_scatter.set_edgecolor(curr_color)

                live_annotation.xy = (curr_x, curr_y)
                live_annotation.set_position((curr_x + 0.15, curr_y + 0.4))
                live_annotation.set_text(f"{curr_residual_pts:+.2f} pts overvixed ({status_text})")
                live_annotation.set_color(curr_color)
                if hasattr(live_annotation, 'arrow_patch') and live_annotation.arrow_patch:
                    live_annotation.arrow_patch.set_facecolor(curr_color)
                    live_annotation.arrow_patch.set_edgecolor(curr_color)

                # Dynamically adjust axis limits if point approaches edge
                x_lims = ax.get_xlim()
                y_lims = ax.get_ylim()
                need_rescale = False
                new_xmin, new_xmax = x_lims
                new_ymin, new_ymax = y_lims

                if curr_x < x_lims[0] + 0.2:
                    new_xmin = curr_x - 0.5
                    need_rescale = True
                if curr_x > x_lims[1] - 0.2:
                    new_xmax = curr_x + 0.5
                    need_rescale = True
                if curr_y < y_lims[0] + 0.3:
                    new_ymin = curr_y - 0.6
                    need_rescale = True
                if curr_y > y_lims[1] - 0.3:
                    new_ymax = curr_y + 0.6
                    need_rescale = True

                if need_rescale:
                    ax.set_xlim(new_xmin, new_xmax)
                    ax.set_ylim(new_ymin, new_ymax)

                header_metrics = (
                    f"R² = {r_squared:.2f}  ·  SLOPE = {slope:.2f}  ·  VOL SLOPE = {vol_slope:.2f}  ·  "
                    f"RESIDUAL = {curr_residual_pts:+.2f} pts  [{badge}]"
                )
                price_subtext = (
                    f"IBKR [{mode_tag}]: SPX {spx_curr:.2f} ({curr_x:+.2f}%)  |  "
                    f"VIX {vix_curr:.2f} ({curr_y:+.2f} pts)"
                )

                ax.set_title(
                    f"SPX Statistics — Spot-Vol Correlation (IBKR Live Overvix)\n{header_metrics}\n{price_subtext}",
                    loc='left', fontsize=10, color='#D5DAE6', pad=12
                )

                fig.canvas.draw_idle()
                plt.pause(0.01)

            # Terminal log
            now = time.time()
            if now - last_print_time >= 4.0 or args.once:
                last_print_time = now
                print(
                    f"[{time.strftime('%H:%M:%S')}] [{mode_tag}] "
                    f"SPX: {spx_curr:7.2f} ({curr_x:+6.2f}%) | "
                    f"VIX: {vix_curr:5.2f} ({curr_y:+5.2f} pts) | "
                    f"Exp: {curr_expected:+5.2f} | "
                    f"Resid: {curr_residual_pts:+5.2f} pts | {badge}",
                    flush=True
                )

            if args.once:
                print("\n[Run Once] Single snapshot completed successfully.", flush=True)
                if not args.no_plot:
                    print("[Run Once] Showing chart. Close the window to finish.", flush=True)
                    plt.ioff()
                    plt.show()
                break

    except KeyboardInterrupt:
        print("\n[IBKR] Monitoring stopped by user (Ctrl+C).", flush=True)
    finally:
        print("[IBKR] Unsubscribing market data and disconnecting...", flush=True)
        try:
            ib.cancelMktData(spx_contract)
            ib.cancelMktData(vix_contract)
            ib.disconnect()
        except Exception:
            pass
        print("[IBKR] Clean shutdown complete.", flush=True)


if __name__ == '__main__':
    main()
