r"""
Overvix & Volatility Term Structure (VIX/VIX3M) Real-Time Web Dashboard
=======================================================================
A high-performance FastAPI web application powered by Interactive Brokers (IBKR):
  - Spot-Vol Regression & Overvix (+2.0 pt) Signal Monitor
  - Intraday & Macro Volatility Term Structure (VIX / VIX3M) & Inversion Monitor
  - Intraday SPX vs. VIX Dynamic Correlation & Decoupling Monitor
  - Real-time streaming WebSocket push to browser
  - Interactive Plotly.js charts & audio alerts

Requirements:
    pip install ib-async fastapi "uvicorn[standard]" websockets pandas numpy scipy

Usage:
    .\.venv\Scripts\python.exe dashboard.py
    .\.venv\Scripts\python.exe dashboard.py --port 7496 --web-port 8000
    .\.venv\Scripts\python.exe dashboard.py --no-browser
"""

import sys
import os
import time
import math
import argparse
import asyncio
import warnings
import webbrowser
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager

warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
from scipy import stats
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

# Ensure asyncio event loop exists in Python 3.12+ / 3.14+ / 3.15+
try:
    loop = asyncio.get_event_loop()
except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

# Import IBKR library (prefer ib_async, fallback to ib_insync)
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
# CONFIGURATION DEFAULTS
# ==============================================================================
DEFAULT_IBKR_HOST = '127.0.0.1'
DEFAULT_IBKR_PORT = 7496        # 7496: TWS Live, 7497: TWS Paper, 4001: Gateway Live, 4002: Gateway Paper
DEFAULT_CLIENT_ID = 20
DEFAULT_WEB_PORT = 8000
DEFAULT_WINDOW_DAYS = 60
DEFAULT_THRESHOLD_PTS = 2.0
DEFAULT_UPDATE_INTERVAL = 1.0
COMMON_IBKR_PORTS = [7496, 7497, 4001, 4002]


# ==============================================================================
# IBKR ENGINE & STATE STORE
# ==============================================================================
class DashboardState:
    def __init__(self):
        self.ib: Optional[Any] = None
        self.is_connected: bool = False
        self.port: int = DEFAULT_IBKR_PORT
        self.client_id: int = DEFAULT_CLIENT_ID
        self.window_days: int = DEFAULT_WINDOW_DAYS
        self.threshold_pts: float = DEFAULT_THRESHOLD_PTS
        self.interval: float = DEFAULT_UPDATE_INTERVAL

        # Contracts
        self.spx_contract = None
        self.vix_contract = None
        self.vix3m_contract = None

        # Tickers
        self.spx_ticker = None
        self.vix_ticker = None
        self.vix3m_ticker = None

        # Historical datasets
        self.df_spotvol = pd.DataFrame()
        self.df_ts_1d = pd.DataFrame()       # Intraday 1-min bars for VIX/VIX3M
        self.df_ts_5d = pd.DataFrame()       # Recent 5-day 15-min bars for VIX/VIX3M
        self.df_ts_1y = pd.DataFrame()       # Macro 1-year daily bars for VIX/VIX3M
        self.df_spx_vix_1d = pd.DataFrame()  # Intraday 1-min bars for SPX & VIX
        self.df_spx_vix_5d = pd.DataFrame()  # 5-day 15-min bars for SPX & VIX
        self.df_spx_vix_1y = pd.DataFrame()  # Macro 1-year daily bars for SPX & VIX

        # Model metrics
        self.r_squared: float = 0.0
        self.slope: float = 0.0
        self.vol_slope: float = 0.0
        self.intercept: float = 0.0

        # Reference closes
        self.latest_spx_close: float = 0.0
        self.latest_vix_close: float = 0.0
        self.latest_vix3m_close: float = 0.0
        self.prior_spx_close: float = 0.0
        self.prior_vix_close: float = 0.0
        self.prior_vix3m_close: float = 0.0
        self.prior_ratio_close: float = 0.0
        self.last_sess_x: float = 0.0
        self.last_sess_y: float = 0.0

        # Intraday stats
        self.intraday_high_ratio: float = 0.0
        self.intraday_low_ratio: float = 0.0
        self.intraday_open_ratio: float = 0.0
        self.current_rolling_corr: float = -0.75
        self.corr_5d: float = -0.75
        self.corr_1y: float = -0.75

        # Active WebSockets
        self.active_websockets: List[WebSocket] = []

state = DashboardState()


def get_current_price(ticker, fallback_price: float = 0.0):
    """
    Extract best available current price from an IBKR Ticker object.
    Prefers live trades (last), then marketPrice(), then bid/ask midpoint, then close.
    """
    if ticker is None:
        return fallback_price, "FALLBACK"

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


async def connect_and_init_ibkr(host: str, port: int, client_id: int):
    """
    Connect to IBKR, qualify contracts, fetch historical bars, and subscribe to market data.
    """
    if IB is None:
        print("[IBKR Error] Neither 'ib-async' nor 'ib_insync' is installed.")
        return False

    state.ib = IB()
    ports_to_try = [port] + [p for p in COMMON_IBKR_PORTS if p != port]

    connected = False
    for p in ports_to_try:
        try:
            print(f"[IBKR] Attempting connection to {host}:{p} (ClientId: {client_id})...")
            await state.ib.connectAsync(host, p, clientId=client_id, timeout=3)
            connected = True
            state.port = p
            state.is_connected = True
            print(f" Connected successfully to IBKR on port {p}!")
            break
        except Exception as e:
            print(f"  Could not connect on port {p}: {e}")

    if not connected:
        print(f"[IBKR Error] Failed to connect to IBKR at {host} on ports {ports_to_try}.")
        state.is_connected = False
        return False

    state.ib.reqMarketDataType(3)

    # 1. Qualify Contracts
    state.spx_contract = Index('SPX', 'CBOE', 'USD')
    state.vix_contract = Index('VIX', 'CBOE', 'USD')
    state.vix3m_contract = Index('VIX3M', 'CBOE', 'USD')

    print("[IBKR] Qualifying index contracts (SPX, VIX, VIX3M)...")
    await state.ib.qualifyContractsAsync(state.spx_contract, state.vix_contract)
    try:
        await state.ib.qualifyContractsAsync(state.vix3m_contract)
    except Exception:
        print("  VIX3M qualification failed. Trying legacy symbol VXV...")
        state.vix3m_contract = Index('VXV', 'CBOE', 'USD')
        await state.ib.qualifyContractsAsync(state.vix3m_contract)

    print(f" SPX: conId={state.spx_contract.conId}, symbol={state.spx_contract.symbol}")
    print(f" VIX: conId={state.vix_contract.conId}, symbol={state.vix_contract.symbol}")
    print(f" VIX3M: conId={state.vix3m_contract.conId}, symbol={state.vix3m_contract.symbol}")

    # 2. Fetch Historical Bars (Spot-Vol, Intraday 1D, Weekly 5D, Macro 1Y, Intraday Correlation)
    await refresh_historical_data()

    # 3. Subscribe to Real-Time Streaming Tickers
    print("[IBKR] Subscribing to live market data streams...")
    state.spx_ticker = state.ib.reqMktData(state.spx_contract, '', False, False)
    state.vix_ticker = state.ib.reqMktData(state.vix_contract, '', False, False)
    state.vix3m_ticker = state.ib.reqMktData(state.vix3m_contract, '', False, False)

    for _ in range(10):
        await asyncio.sleep(0.2)
        p1, _ = get_current_price(state.spx_ticker, state.latest_spx_close)
        p2, _ = get_current_price(state.vix_ticker, state.latest_vix_close)
        p3, _ = get_current_price(state.vix3m_ticker, state.latest_vix3m_close)
        if p1 > 0 and p2 > 0 and p3 > 0:
            break

    print(" IBKR Engine initialized and streaming successfully.\n")
    return True


async def refresh_historical_data():
    """
    Fetch historical daily and intraday bars directly from IBKR:
      - Spot-Vol: 120 D daily bars (for 60-day baseline OLS)
      - Term Structure 1D: 1-minute intraday bars for today's session
      - Term Structure 5D: 15-minute bars for recent 5 days
      - Term Structure 1Y: 252-day daily bars for macro history
      - SPX-VIX 1D: 1-minute intraday bars for rolling correlation
    """
    print("[IBKR] Fetching historical baseline & intraday datasets from IBKR...")
    try:
        # A. Spot-Vol Daily Bars (120 D)
        spx_bars = await state.ib.reqHistoricalDataAsync(
            state.spx_contract, endDateTime='', durationStr='120 D',
            barSizeSetting='1 day', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        vix_bars = await state.ib.reqHistoricalDataAsync(
            state.vix_contract, endDateTime='', durationStr='120 D',
            barSizeSetting='1 day', whatToShow='TRADES', useRTH=True, formatDate=1
        )

        df_spx = util.df(spx_bars).set_index('date')['close'].rename('spx_close')
        df_vix = util.df(vix_bars).set_index('date')['close'].rename('vix_close')
        df_sv = pd.concat([df_spx, df_vix], axis=1).dropna()

        df_sv['spx_pct'] = df_sv['spx_close'].pct_change() * 100.0
        df_sv['vix_pt'] = df_sv['vix_close'].diff()
        df_sv = df_sv.dropna()

        state.df_spotvol = df_sv.iloc[-state.window_days:].copy()

        # Baseline regression
        x = state.df_spotvol['spx_pct'].values
        y = state.df_spotvol['vix_pt'].values
        slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
        state.slope = float(slope)
        state.intercept = float(intercept)
        state.r_squared = float(r_value ** 2)
        state.vol_slope = float(1.0 / slope) if slope != 0 else 0.0

        state.latest_spx_close = float(df_sv['spx_close'].iloc[-1])
        state.latest_vix_close = float(df_sv['vix_close'].iloc[-1])
        state.prior_spx_close = float(df_sv['spx_close'].iloc[-2]) if len(df_sv) > 1 else state.latest_spx_close
        state.prior_vix_close = float(df_sv['vix_close'].iloc[-2]) if len(df_sv) > 1 else state.latest_vix_close
        state.last_sess_x = float(state.df_spotvol['spx_pct'].iloc[-1])
        state.last_sess_y = float(state.df_spotvol['vix_pt'].iloc[-1])

        print(f" Spot-Vol Baseline ({len(state.df_spotvol)} bars): R²={state.r_squared:.4f}, Slope={state.slope:.4f}")

        # B. Intraday 1D Bars (SPX, VIX, VIX3M 1-min)
        b1_spx = await state.ib.reqHistoricalDataAsync(
            state.spx_contract, endDateTime='', durationStr='1 D',
            barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        b1_vix = await state.ib.reqHistoricalDataAsync(
            state.vix_contract, endDateTime='', durationStr='1 D',
            barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        b1_vix3m = await state.ib.reqHistoricalDataAsync(
            state.vix3m_contract, endDateTime='', durationStr='1 D',
            barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
        )

        # Term Structure 1D
        df_v1 = util.df(b1_vix).set_index('date')['close'].rename('vix')
        df_v3 = util.df(b1_vix3m).set_index('date')['close'].rename('vix3m')
        df_1d = pd.concat([df_v1, df_v3], axis=1).dropna()
        df_1d['ratio'] = df_1d['vix'] / df_1d['vix3m']
        state.df_ts_1d = df_1d.copy()

        if not state.df_ts_1d.empty:
            state.intraday_open_ratio = float(state.df_ts_1d['ratio'].iloc[0])
            state.intraday_high_ratio = float(state.df_ts_1d['ratio'].max())
            state.intraday_low_ratio = float(state.df_ts_1d['ratio'].min())
        print(f" Intraday 1D Term Structure: {len(state.df_ts_1d)} bars (High: {state.intraday_high_ratio:.4f}, Low: {state.intraday_low_ratio:.4f})")

        # SPX & VIX Intraday Correlation 1D
        df_s1 = util.df(b1_spx).set_index('date')['close'].rename('spx')
        df_sv_1d = pd.concat([df_s1, df_v1], axis=1).dropna()
        if not df_sv_1d.empty:
            ref_spx = state.prior_spx_close if state.prior_spx_close > 0 else float(df_sv_1d['spx'].iloc[0])
            ref_vix = state.prior_vix_close if state.prior_vix_close > 0 else float(df_sv_1d['vix'].iloc[0])
            df_sv_1d['spx_pct'] = (df_sv_1d['spx'] - ref_spx) / ref_spx * 100.0
            df_sv_1d['vix_pt'] = df_sv_1d['vix'] - ref_vix
            df_sv_1d['spx_ret'] = df_sv_1d['spx'].pct_change()
            df_sv_1d['vix_diff'] = df_sv_1d['vix'].diff()
            df_sv_1d['rolling_corr'] = df_sv_1d['spx_ret'].rolling(30, min_periods=10).corr(df_sv_1d['vix_diff']).fillna(-0.70)
            state.df_spx_vix_1d = df_sv_1d.copy()
            state.current_rolling_corr = float(df_sv_1d['rolling_corr'].iloc[-1])
            print(f" Intraday SPX-VIX Correlation: {len(state.df_spx_vix_1d)} bars (Current ρ={state.current_rolling_corr:.3f})")

        # C. Recent 5D Bars (SPX, VIX, VIX3M 15-min bars)
        b5_spx = await state.ib.reqHistoricalDataAsync(
            state.spx_contract, endDateTime='', durationStr='5 D',
            barSizeSetting='15 mins', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        b5_vix = await state.ib.reqHistoricalDataAsync(
            state.vix_contract, endDateTime='', durationStr='5 D',
            barSizeSetting='15 mins', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        b5_vix3m = await state.ib.reqHistoricalDataAsync(
            state.vix3m_contract, endDateTime='', durationStr='5 D',
            barSizeSetting='15 mins', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        df_s1_5 = util.df(b5_spx).set_index('date')['close'].rename('spx')
        df_v1_5 = util.df(b5_vix).set_index('date')['close'].rename('vix')
        df_v3_5 = util.df(b5_vix3m).set_index('date')['close'].rename('vix3m')
        
        # 5D Term Structure
        df_5d = pd.concat([df_v1_5, df_v3_5], axis=1).dropna()
        df_5d['ratio'] = df_5d['vix'] / df_5d['vix3m']
        state.df_ts_5d = df_5d.copy()

        # 5D SPX & VIX Dynamic Correlation (15-min bars, rolling 27-bar ~1 day window)
        df_sv_5d = pd.concat([df_s1_5, df_v1_5], axis=1).dropna()
        if not df_sv_5d.empty:
            ref_spx_5d = float(df_sv_5d['spx'].iloc[0])
            ref_vix_5d = float(df_sv_5d['vix'].iloc[0])
            df_sv_5d['spx_pct'] = (df_sv_5d['spx'] - ref_spx_5d) / ref_spx_5d * 100.0
            df_sv_5d['vix_pt'] = df_sv_5d['vix'] - ref_vix_5d
            df_sv_5d['spx_ret'] = df_sv_5d['spx'].pct_change()
            df_sv_5d['vix_diff'] = df_sv_5d['vix'].diff()
            df_sv_5d['rolling_corr'] = df_sv_5d['spx_ret'].rolling(27, min_periods=10).corr(df_sv_5d['vix_diff']).fillna(-0.75)
            state.df_spx_vix_5d = df_sv_5d.copy()
            state.corr_5d = float(df_sv_5d['rolling_corr'].iloc[-1])
            print(f" 5D SPX-VIX Correlation: {len(state.df_spx_vix_5d)} bars (Current 1D ρ={state.corr_5d:.3f})")

        # D. Macro 1Y Bars (SPX, VIX, VIX3M Daily bars)
        spx_bars_1y = await state.ib.reqHistoricalDataAsync(
            state.spx_contract, endDateTime='', durationStr='252 D',
            barSizeSetting='1 day', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        vix_bars_1y = await state.ib.reqHistoricalDataAsync(
            state.vix_contract, endDateTime='', durationStr='252 D',
            barSizeSetting='1 day', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        vix3m_bars_1y = await state.ib.reqHistoricalDataAsync(
            state.vix3m_contract, endDateTime='', durationStr='252 D',
            barSizeSetting='1 day', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        df_s1y = util.df(spx_bars_1y).set_index('date')['close'].rename('spx')
        df_v1y = util.df(vix_bars_1y).set_index('date')['close'].rename('vix')
        df_v3y = util.df(vix3m_bars_1y).set_index('date')['close'].rename('vix3m')
        
        # 1Y Term Structure
        df_1y = pd.concat([df_v1y, df_v3y], axis=1).dropna()
        df_1y['ratio'] = df_1y['vix'] / df_1y['vix3m']
        state.df_ts_1y = df_1y.copy()

        # 1Y SPX & VIX Dynamic Correlation (Daily bars, rolling 20-day ~1 month window)
        df_sv_1y = pd.concat([df_s1y, df_v1y], axis=1).dropna()
        if not df_sv_1y.empty:
            ref_spx_1y = float(df_sv_1y['spx'].iloc[0])
            ref_vix_1y = float(df_sv_1y['vix'].iloc[0])
            df_sv_1y['spx_pct'] = (df_sv_1y['spx'] - ref_spx_1y) / ref_spx_1y * 100.0
            df_sv_1y['vix_pt'] = df_sv_1y['vix'] - ref_vix_1y
            df_sv_1y['spx_ret'] = df_sv_1y['spx'].pct_change()
            df_sv_1y['vix_diff'] = df_sv_1y['vix'].diff()
            df_sv_1y['rolling_corr'] = df_sv_1y['spx_ret'].rolling(20, min_periods=10).corr(df_sv_1y['vix_diff']).fillna(-0.75)
            state.df_spx_vix_1y = df_sv_1y.copy()
            state.corr_1y = float(df_sv_1y['rolling_corr'].iloc[-1])
            print(f" 1Y SPX-VIX Correlation: {len(state.df_spx_vix_1y)} bars (Current 20D ρ={state.corr_1y:.3f})")

        state.latest_vix3m_close = float(df_1y['vix3m'].iloc[-1])
        state.prior_vix3m_close = float(df_1y['vix3m'].iloc[-2]) if len(df_1y) > 1 else state.latest_vix3m_close
        state.prior_ratio_close = float(df_1y['ratio'].iloc[-2]) if len(df_1y) > 1 else float(df_1y['ratio'].iloc[-1])
        print(f" Macro 1Y Term Structure: {len(state.df_ts_1y)} daily bars (Prior Close Ratio: {state.prior_ratio_close:.4f})\n")

    except Exception as ex:
        print(f"[IBKR Error] Historical data refresh failed: {ex}")


def compute_live_payload() -> Dict[str, Any]:
    """
    Compute full real-time snapshot of market prices, Overvix residuals,
    intraday term structure ratio stats, rolling correlation, and master confluence signal.
    """
    spx_curr, spx_src = get_current_price(state.spx_ticker, state.latest_spx_close)
    vix_curr, vix_src = get_current_price(state.vix_ticker, state.latest_vix_close)
    vix3m_curr, vix3m_src = get_current_price(state.vix3m_ticker, state.latest_vix_close)

    is_live = ("LIVE" in spx_src or "LIVE" in vix_src or "LIVE" in vix3m_src)

    if is_live:
        spx_base = state.latest_spx_close if state.latest_spx_close > 0 else spx_curr
        vix_base = state.latest_vix_close if state.latest_vix_close > 0 else vix_curr
        vix3m_base = state.latest_vix3m_close if state.latest_vix3m_close > 0 else vix3m_curr

        curr_x = ((spx_curr - spx_base) / spx_base) * 100.0 if spx_base > 0 else 0.0
        curr_y = vix_curr - vix_base
        vix3m_pt = vix3m_curr - vix3m_base
        mode_tag = "LIVE TRADING"
    else:
        # Market closed / offline: display latest completed session official results
        curr_x = state.last_sess_x
        curr_y = state.last_sess_y
        spx_curr = state.latest_spx_close
        vix_curr = state.latest_vix_close
        vix3m_curr = state.latest_vix3m_close
        vix3m_pt = 0.0
        mode_tag = "LATEST SESSION (CLOSED)"

    # Overvix Calculations
    expected_vix_pt = state.intercept + state.slope * curr_x
    residual_pts = curr_y - expected_vix_pt
    is_overvixed = bool(residual_pts >= state.threshold_pts)

    # Term Structure Calculations
    ratio = float(vix_curr / vix3m_curr) if vix3m_curr > 0 else 0.0
    is_inverted = bool(ratio >= 1.00)
    is_flattening = bool(0.90 <= ratio < 1.00)

    # Intraday Ratio High/Low tracking
    if ratio > 0:
        if state.intraday_high_ratio == 0 or ratio > state.intraday_high_ratio:
            state.intraday_high_ratio = ratio
        if state.intraday_low_ratio == 0 or ratio < state.intraday_low_ratio:
            state.intraday_low_ratio = ratio

    ratio_change_pts = ratio - state.prior_ratio_close if state.prior_ratio_close > 0 else 0.0
    ratio_change_pct = (ratio_change_pts / state.prior_ratio_close * 100.0) if state.prior_ratio_close > 0 else 0.0

    # Intraday SPX-VIX Correlation Evaluation
    corr_val = state.current_rolling_corr
    if corr_val < -0.40:
        corr_status = "NORMAL INVERSE"
        corr_desc = "Healthy inverse spot-vol correlation (SPX & VIX moving opposite)."
        corr_badge = "HEALTHY"
    elif corr_val < 0.0:
        corr_status = "WEAKENING"
        corr_desc = "Spot-vol correlation weakening towards zero."
        corr_badge = "CAUTION"
    else:
        corr_status = "POSITIVE DECOUPLING"
        corr_desc = "Spot-vol decoupling: SPX and VIX moving in tandem!"
        corr_badge = "DECOUPLED"

    # Master Confluence Signals
    is_dual_alert = bool(is_overvixed and is_inverted)
    is_overvix_alert = bool(is_overvixed and not is_inverted)
    is_inversion_alert = bool(is_inverted and not is_overvixed)
    is_normal = bool(not is_overvixed and not is_inverted)

    if is_dual_alert:
        confluence_tag = "CAPITULATION DUAL ALERT"
        confluence_desc = "High-Conviction Mean-Reversion Long: Overvix Triggered + Vol Curve Inverted (Backwardation)"
    elif is_overvix_alert:
        confluence_tag = "OVERVIX ALERT"
        confluence_desc = f"Spot-Vol Shock: VIX is {residual_pts:+.2f} pts above expected line."
    elif is_inversion_alert:
        confluence_tag = "TERM STRUCTURE INVERTED"
        confluence_desc = f"Backwardation: Front-month VIX exceeds 90-day VIX3M (Ratio: {ratio:.4f})."
    elif is_flattening:
        confluence_tag = "CURVE FLATTENING"
        confluence_desc = f"Pre-Panic: Volatility curve flattening towards 1.00 (Ratio: {ratio:.4f})."
    else:
        confluence_tag = "NORMAL REGIME"
        confluence_desc = f"Normal Contango: Vol term structure normal ({ratio:.4f}). Normal spot-vol ({residual_pts:+.2f} pts)."

    curr_time_str = time.strftime('%H:%M:%S')
    curr_dt_str = time.strftime('%Y-%m-%d %H:%M')

    return {
        "timestamp": curr_time_str,
        "datetime": curr_dt_str,
        "mode": mode_tag,
        "connection": {
            "connected": state.is_connected,
            "port": state.port,
            "clientId": state.client_id
        },
        "market": {
            "spx": {
                "current": round(spx_curr, 2),
                "pct_change": round(curr_x, 2),
                "source": spx_src
            },
            "vix": {
                "current": round(vix_curr, 2),
                "pt_change": round(curr_y, 2),
                "source": vix_src
            },
            "vix3m": {
                "current": round(vix3m_curr, 2),
                "pt_change": round(vix3m_pt, 2),
                "source": vix3m_src
            }
        },
        "model": {
            "r_squared": round(state.r_squared, 4),
            "slope": round(state.slope, 4),
            "vol_slope": round(state.vol_slope, 4),
            "intercept": round(state.intercept, 4),
            "window_days": state.window_days,
            "threshold_pts": round(state.threshold_pts, 2)
        },
        "overvix": {
            "expected_vix_pt": round(expected_vix_pt, 2),
            "residual_pts": round(residual_pts, 2),
            "is_overvixed": is_overvixed,
            "status": "OVERVIXED" if is_overvixed else "NORMAL"
        },
        "term_structure": {
            "ratio": round(ratio, 4),
            "is_inverted": is_inverted,
            "is_flattening": is_flattening,
            "regime": "BACKWARDATION" if is_inverted else ("FLATTENING" if is_flattening else "CONTANGO"),
            "intraday": {
                "high": round(state.intraday_high_ratio, 4),
                "low": round(state.intraday_low_ratio, 4),
                "open": round(state.intraday_open_ratio, 4),
                "change_pts": round(ratio_change_pts, 4),
                "change_pct": round(ratio_change_pct, 2),
                "latest_time": curr_time_str[:5]
            }
        },
        "correlation": {
            "rolling_corr": round(corr_val, 3),
            "corr_5d": round(state.corr_5d, 3),
            "corr_1y": round(state.corr_1y, 3),
            "status": corr_status,
            "badge": corr_badge,
            "desc": corr_desc
        },
        "confluence": {
            "tag": confluence_tag,
            "description": confluence_desc,
            "is_dual_alert": is_dual_alert,
            "is_overvix_alert": is_overvix_alert,
            "is_inversion_alert": is_inversion_alert,
            "is_normal": is_normal
        },
        "current_point": {
            "x": round(curr_x, 2),
            "y": round(curr_y, 2)
        }
    }


# ==============================================================================
# FASTAPI APPLICATION & LIFESPAN
# ==============================================================================
background_broadcast_task = None

async def broadcast_loop():
    """
    Push synchronized live data snapshots to all connected WebSockets,
    and monitor/reconnect IBKR connection if dropped or offline.
    """
    last_reconnect_attempt = 0

    while True:
        try:
            await asyncio.sleep(state.interval)
            now = time.time()

            # Auto-reconnect check if IBKR is offline
            if not state.is_connected or (state.ib and not state.ib.isConnected()):
                state.is_connected = False
                if now - last_reconnect_attempt >= 5.0:
                    last_reconnect_attempt = now
                    try:
                        await connect_and_init_ibkr(DEFAULT_IBKR_HOST, state.port, state.client_id)
                    except Exception as e:
                        print(f"[IBKR Reconnect] Still waiting for TWS/Gateway: {e}")

            if not state.active_websockets:
                continue

            payload = compute_live_payload()
            disconnected = []

            for ws in state.active_websockets:
                try:
                    await ws.send_json(payload)
                except Exception:
                    disconnected.append(ws)

            for ws in disconnected:
                if ws in state.active_websockets:
                    state.active_websockets.remove(ws)

        except asyncio.CancelledError:
            break
        except Exception as e:
            await asyncio.sleep(1.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global background_broadcast_task
    print("\n" + "=" * 65)
    print("STARTING OVERVIX & VIX/VIX3M UNIFIED DASHBOARD")
    print("=" * 65)

    await connect_and_init_ibkr(DEFAULT_IBKR_HOST, DEFAULT_IBKR_PORT, DEFAULT_CLIENT_ID)
    background_broadcast_task = asyncio.create_task(broadcast_loop())

    yield

    print("\n[Dashboard] Shutting down...")
    if background_broadcast_task:
        background_broadcast_task.cancel()

    if state.ib and state.ib.isConnected():
        print("[IBKR] Unsubscribing market data and disconnecting...")
        try:
            if state.spx_contract: state.ib.cancelMktData(state.spx_contract)
            if state.vix_contract: state.ib.cancelMktData(state.vix_contract)
            if state.vix3m_contract: state.ib.cancelMktData(state.vix3m_contract)
            state.ib.disconnect()
        except Exception:
            pass
    print("[Dashboard] Shutdown complete.")


app = FastAPI(title="Overvix & Term Structure Terminal", lifespan=lifespan)

# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), 'static')
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def get_index():
    index_file = os.path.join(static_dir, 'index.html')
    return FileResponse(index_file)


@app.get("/api/bootstrap")
async def get_bootstrap():
    """
    Deliver full historical & intraday datasets for instant client charting:
      - 60-day Spot-Vol points
      - 1D intraday 1-minute bars (Term Structure & SPX-VIX Correlation)
      - 5D weekly 15-minute bars
      - 1Y macro daily bars
    """
    live = compute_live_payload()

    # Format Spot-Vol history
    x_hist = [round(float(v), 2) for v in state.df_spotvol['spx_pct'].tolist()] if not state.df_spotvol.empty else []
    y_hist = [round(float(v), 2) for v in state.df_spotvol['vix_pt'].tolist()] if not state.df_spotvol.empty else []
    dates_sv = [str(d)[:10] for d in state.df_spotvol.index] if not state.df_spotvol.empty else []

    # Helper to convert DatetimeIndex cleanly to US/Eastern ISO strings for Plotly
    def to_eastern_dt_list(idx):
        if idx is None or len(idx) == 0:
            return []
        try:
            if hasattr(idx, 'tz') and idx.tz is not None:
                idx_et = idx.tz_convert('US/Eastern')
            else:
                idx_et = idx
            return [t.strftime('%Y-%m-%d %H:%M') for t in idx_et]
        except Exception:
            return [str(t)[:16] for t in idx]

    # Format SPX vs VIX Correlation across 1D, 5D, 1Y
    def format_corr_df(df, is_daily=False):
        if df.empty:
            return {"times": [], "spx_pct": [], "vix_pt": [], "rolling_corr": []}
        if is_daily:
            times = [str(d)[:10] for d in df.index]
        else:
            times = to_eastern_dt_list(df.index)
        return {
            "times": times,
            "spx_pct": [round(float(v), 2) for v in df['spx_pct'].tolist()],
            "vix_pt": [round(float(v), 2) for v in df['vix_pt'].tolist()],
            "rolling_corr": [round(float(v), 3) for v in df['rolling_corr'].tolist()]
        }

    corr_1d = format_corr_df(state.df_spx_vix_1d)
    corr_5d = format_corr_df(state.df_spx_vix_5d)
    corr_1y = format_corr_df(state.df_spx_vix_1y, is_daily=True)

    # Format Intraday 1D Term Structure
    if not state.df_ts_1d.empty:
        t1d = to_eastern_dt_list(state.df_ts_1d.index)
        v1d_vix = [round(float(v), 2) for v in state.df_ts_1d['vix'].tolist()]
        v1d_vix3m = [round(float(v), 2) for v in state.df_ts_1d['vix3m'].tolist()]
        v1d_ratio = [round(float(v), 4) for v in state.df_ts_1d['ratio'].tolist()]
    else:
        t1d, v1d_vix, v1d_vix3m, v1d_ratio = [], [], [], []

    # Format 5D Term Structure
    if not state.df_ts_5d.empty:
        t5d = to_eastern_dt_list(state.df_ts_5d.index)
        v5d_vix = [round(float(v), 2) for v in state.df_ts_5d['vix'].tolist()]
        v5d_vix3m = [round(float(v), 2) for v in state.df_ts_5d['vix3m'].tolist()]
        v5d_ratio = [round(float(v), 4) for v in state.df_ts_5d['ratio'].tolist()]
    else:
        t5d, v5d_vix, v5d_vix3m, v5d_ratio = [], [], [], []

    # Format 1Y Term Structure
    if not state.df_ts_1y.empty:
        t1y = [str(d)[:10] for d in state.df_ts_1y.index]
        v1y_vix = [round(float(v), 2) for v in state.df_ts_1y['vix'].tolist()]
        v1y_vix3m = [round(float(v), 2) for v in state.df_ts_1y['vix3m'].tolist()]
        v1y_ratio = [round(float(v), 4) for v in state.df_ts_1y['ratio'].tolist()]
    else:
        t1y, v1y_vix, v1y_vix3m, v1y_ratio = [], [], [], []

    return {
        **live,
        "overvix": {
            **live["overvix"],
            "x_history": x_hist,
            "y_history": y_hist,
            "dates": dates_sv,
            "intraday_trail": {
                "x": corr_1d["spx_pct"],
                "y": corr_1d["vix_pt"],
                "times": corr_1d["times"]
            }
        },
        "term_structure": {
            **live["term_structure"],
            "intraday_1d": {
                "times": t1d,
                "vix": v1d_vix,
                "vix3m": v1d_vix3m,
                "ratio": v1d_ratio
            },
            "intraday_5d": {
                "times": t5d,
                "vix": v5d_vix,
                "vix3m": v5d_vix3m,
                "ratio": v5d_ratio
            },
            "history_1y": {
                "dates": t1y,
                "vix": v1y_vix,
                "vix3m": v1y_vix3m,
                "ratio": v1y_ratio
            }
        },
        "intraday_correlation": {
            "times": corr_1d["times"],
            "spx_pct": corr_1d["spx_pct"],
            "vix_pt": corr_1d["vix_pt"],
            "rolling_corr": corr_1d["rolling_corr"],
            "current_corr": round(state.current_rolling_corr, 3),
            "1D": corr_1d,
            "5D": corr_5d,
            "1Y": corr_1y,
            "metrics": {
                "1D": round(state.current_rolling_corr, 3),
                "5D": round(state.corr_5d, 3),
                "1Y": round(state.corr_1y, 3)
            }
        }
    }


@app.get("/api/status")
async def get_status():
    return compute_live_payload()


class ConfigRequest(BaseModel):
    threshold: Optional[float] = None
    window: Optional[int] = None
    interval: Optional[float] = None


@app.post("/api/config")
async def post_config(req: ConfigRequest):
    if req.threshold is not None:
        state.threshold_pts = float(req.threshold)
    if req.window is not None and req.window != state.window_days:
        state.window_days = int(req.window)
        await refresh_historical_data()
    if req.interval is not None:
        state.interval = max(0.2, float(req.interval))

    return {"status": "ok", "threshold": state.threshold_pts, "window": state.window_days, "interval": state.interval}


@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state.active_websockets.append(websocket)
    try:
        await websocket.send_json(compute_live_payload())
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in state.active_websockets:
            state.active_websockets.remove(websocket)
    except Exception:
        if websocket in state.active_websockets:
            state.active_websockets.remove(websocket)


# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Overvix & VIX/VIX3M Live Web Terminal")
    parser.add_argument('--port', type=int, default=DEFAULT_IBKR_PORT, help=f"IBKR socket port (default: {DEFAULT_IBKR_PORT})")
    parser.add_argument('--web-port', type=int, default=DEFAULT_WEB_PORT, help=f"Web server port (default: {DEFAULT_WEB_PORT})")
    parser.add_argument('--client-id', type=int, default=DEFAULT_CLIENT_ID, help=f"API Client ID (default: {DEFAULT_CLIENT_ID})")
    parser.add_argument('--no-browser', action='store_true', help="Do not automatically open browser on launch")
    args = parser.parse_args()

    state.port = args.port
    state.client_id = args.client_id

    if not args.no_browser:
        def open_browser():
            time.sleep(1.2)
            url = f"http://localhost:{args.web_port}"
            print(f"[Dashboard] Opening web dashboard in browser: {url}")
            webbrowser.open(url)
        import threading
        threading.Thread(target=open_browser, daemon=True).start()

    print(f"[Dashboard] Running on http://127.0.0.1:{args.web_port}")
    uvicorn.run(app, host="127.0.0.1", port=args.web_port, log_level="warning")


if __name__ == '__main__':
    main()
