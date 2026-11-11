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
from datetime import datetime, time as dtime
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager
import pickle
import urllib.request
import pytz

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
    from ib_async import IB, Index, Future, util
except ImportError:
    try:
        from ib_insync import IB, Index, Future, util
    except ImportError:
        IB = None
        Index = None
        Future = None
        util = None

from session_history import (
    fetch_and_build_historical_session,
    get_cached_dates,
    load_cached_session,
    load_notable_dates,
    save_notable_date
)

# ==============================================================================
# CONFIGURATION DEFAULTS
# ==============================================================================
DEFAULT_IBKR_HOST = '127.0.0.1'
DEFAULT_IBKR_PORT = 7496        # 7496: TWS Live, 7497: TWS Paper, 4001: Gateway Live, 4002: Gateway Paper
DEFAULT_CLIENT_ID = 20
DEFAULT_WEB_PORT = 8000
DEFAULT_WINDOW_DAYS = 60
DEFAULT_SPX_THRESHOLD_PTS = 2.0
DEFAULT_NDX_THRESHOLD_PTS = 2.5
DEFAULT_THRESHOLD_PTS = DEFAULT_SPX_THRESHOLD_PTS
DEFAULT_UPDATE_INTERVAL = 1.0
COMMON_IBKR_PORTS = [7496, 7497, 4001, 4002]
CACHE_PATH = os.path.join(os.path.dirname(__file__), 'data', 'history_cache.pkl')
ET_TZ = pytz.timezone('US/Eastern')


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
        self.spx_threshold_pts: float = DEFAULT_SPX_THRESHOLD_PTS
        self.ndx_threshold_pts: float = DEFAULT_NDX_THRESHOLD_PTS
        self.threshold_pts: float = DEFAULT_SPX_THRESHOLD_PTS
        self.interval: float = DEFAULT_UPDATE_INTERVAL

        # Contracts
        self.spx_contract = None
        self.vix_contract = None
        self.vix3m_contract = None
        self.ndx_contract = None
        self.vxn_contract = None
        self.es_contract = None

        # Tickers
        self.spx_ticker = None
        self.vix_ticker = None
        self.vix3m_ticker = None
        self.ndx_ticker = None
        self.vxn_ticker = None
        self.es_ticker = None

        # ES Futures & GTH State
        self.latest_es_close: float = 0.0
        self.es_spx_basis: Optional[float] = None
        self.es_basis_source: str = ""
        self.es_basis_date: Optional[str] = None
        self.eod_spx_close: Optional[float] = None
        self.eod_es_close: Optional[float] = None
        self.eod_vix_close: Optional[float] = None
        self.eod_es_spx_basis: Optional[float] = None
        self.gth_session_date: Optional[str] = None
        self.last_gth_bar_refresh_ts: float = 0.0
        self.last_eod_basis_sync_date: Optional[str] = None
        self.es_daily_df: pd.DataFrame = pd.DataFrame()
        self.df_spx_vix_1d_gth: pd.DataFrame = pd.DataFrame()
        self.df_spx_vix_5d_gth: pd.DataFrame = pd.DataFrame()
        self.df_spotvol_gth: pd.DataFrame = pd.DataFrame()
        self.gth_metrics: Dict[str, Any] = {}
        self.current_rolling_corr_gth: float = -0.75
        self.corr_5d_gth: float = -0.75
        self.gth_slope: Optional[float] = None
        self.gth_intercept: Optional[float] = None
        self.gth_r_squared: Optional[float] = None
        self.gth_vol_slope: Optional[float] = None
        self.daily_basis_map: Dict[str, float] = {}
        self.daily_spx_close_map: Dict[str, float] = {}
        self.daily_es_close_map: Dict[str, float] = {}
        self.daily_vix_close_map: Dict[str, float] = {}
        self.gth_ref_spx: float = 0.0
        self.gth_ref_vix: float = 0.0

        # Historical datasets (SPX & VIX)
        self.df_spotvol = pd.DataFrame()
        self.df_ts_1d = pd.DataFrame()       # Intraday 1-min bars for VIX/VIX3M
        self.df_ts_5d = pd.DataFrame()       # Recent 5-day 5-min bars for VIX/VIX3M
        self.df_ts_1m = pd.DataFrame()       # 1-Month 30-min bars for VIX/VIX3M
        self.df_ts_3m = pd.DataFrame()       # 3-Month 30-min bars for VIX/VIX3M
        self.df_ts_6m = pd.DataFrame()       # 6-Month 30-min bars for VIX/VIX3M
        self.df_ts_ytd = pd.DataFrame()      # YTD daily bars for VIX/VIX3M
        self.df_ts_1y = pd.DataFrame()       # Macro 1-year daily bars for VIX/VIX3M
        self.df_ts_max = pd.DataFrame()      # 2-Year daily bars for VIX/VIX3M

        self.df_spx_vix_1d = pd.DataFrame()  # Intraday 1-min bars for SPX & VIX
        self.df_spx_vix_5d = pd.DataFrame()  # 5-day 5-min bars for SPX & VIX
        self.df_spx_vix_1m = pd.DataFrame()  # 1-Month 30-min bars for SPX & VIX
        self.df_spx_vix_3m = pd.DataFrame()  # 3-Month 30-min bars for SPX & VIX
        self.df_spx_vix_6m = pd.DataFrame()  # 6-Month 30-min bars for SPX & VIX
        self.df_spx_vix_ytd = pd.DataFrame() # YTD daily bars for SPX & VIX
        self.df_spx_vix_1y = pd.DataFrame()  # Macro 1-year daily bars for SPX & VIX
        self.df_spx_vix_max = pd.DataFrame() # 2-Year daily bars for SPX & VIX

        # Historical datasets (NDX & VXN & Tech Vol Spread)
        self.df_spotvol_ndx = pd.DataFrame()
        self.df_ndx_vxn_1d = pd.DataFrame()  # Intraday 1-min bars for NDX & VXN
        self.df_ndx_vxn_5d = pd.DataFrame()  # 5-day 5-min bars for NDX & VXN
        self.df_ndx_vxn_1m = pd.DataFrame()  # 1-Month 30-min bars for NDX & VXN
        self.df_ndx_vxn_3m = pd.DataFrame()  # 3-Month 30-min bars for NDX & VXN
        self.df_ndx_vxn_6m = pd.DataFrame()  # 6-Month 30-min bars for NDX & VXN
        self.df_ndx_vxn_ytd = pd.DataFrame() # YTD daily bars for NDX & VXN
        self.df_ndx_vxn_1y = pd.DataFrame()  # Macro 1-year daily bars for NDX & VXN
        self.df_ndx_vxn_max = pd.DataFrame() # 2-Year daily bars for NDX & VXN

        self.df_tech_vol_1d = pd.DataFrame() # 1-min bars for VXN - VIX & VXN / VIX
        self.df_tech_vol_5d = pd.DataFrame()
        self.df_tech_vol_1m = pd.DataFrame()
        self.df_tech_vol_3m = pd.DataFrame()
        self.df_tech_vol_6m = pd.DataFrame()
        self.df_tech_vol_ytd = pd.DataFrame()
        self.df_tech_vol_1y = pd.DataFrame()
        self.df_tech_vol_max = pd.DataFrame()

        # Combined daily dataset for historical slicing (SPX, VIX, VIX3M, NDX, VXN)
        self.df_daily = pd.DataFrame()

        # Model metrics (SPX / VIX)
        self.r_squared: float = 0.0
        self.slope: float = 0.0
        self.vol_slope: float = 0.0
        self.intercept: float = 0.0

        # Model metrics (NDX / VXN)
        self.ndx_r_squared: float = 0.0
        self.ndx_slope: float = 0.0
        self.ndx_vol_slope: float = 0.0
        self.ndx_intercept: float = 0.0

        # Reference closes (SPX / VIX / VIX3M)
        self.latest_spx_close: float = 0.0
        self.latest_vix_close: float = 0.0
        self.latest_vix3m_close: float = 0.0
        self.prior_spx_close: float = 0.0
        self.prior_vix_close: float = 0.0
        self.prior_vix3m_close: float = 0.0
        self.prior_ratio_close: float = 0.0
        self.last_sess_x: float = 0.0
        self.last_sess_y: float = 0.0

        # Reference closes (NDX / VXN)
        self.latest_ndx_close: float = 0.0
        self.latest_vxn_close: float = 0.0
        self.prior_ndx_close: float = 0.0
        self.prior_vxn_close: float = 0.0
        self.prior_tech_spread_close: float = 0.0
        self.prior_tech_ratio_close: float = 0.0
        self.last_sess_ndx_x: float = 0.0
        self.last_sess_ndx_y: float = 0.0

        # Intraday stats (SPX / VIX / Term Structure)
        self.intraday_high_ratio: float = 0.0
        self.intraday_low_ratio: float = 0.0
        self.intraday_open_ratio: float = 0.0
        self.current_rolling_corr: float = -0.75
        self.corr_5d: float = -0.75
        self.corr_1m: float = -0.75
        self.corr_3m: float = -0.75
        self.corr_6m: float = -0.75
        self.corr_ytd: float = -0.75
        self.corr_1y: float = -0.75
        self.corr_max: float = -0.75

        # Intraday stats (NDX / VXN)
        self.current_rolling_corr_ndx: float = -0.75
        self.corr_5d_ndx: float = -0.75
        self.corr_1m_ndx: float = -0.75
        self.corr_3m_ndx: float = -0.75
        self.corr_6m_ndx: float = -0.75
        self.corr_ytd_ndx: float = -0.75
        self.corr_1y_ndx: float = -0.75
        self.corr_max_ndx: float = -0.75

        # Intraday stats (Tech Vol Spread & Ratio)
        self.active_session_date: Optional[str] = None
        self.tech_spread_low: float = 0.0
        self.tech_spread_high: float = 0.0
        self.tech_spread_open: float = 0.0
        self.tech_ratio_low: float = 0.0
        self.tech_ratio_high: float = 0.0
        self.hist_version: int = 0

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


async def resolve_front_es_contract(ib_client) -> Optional[Any]:
    """Resolve and qualify the active front-month CME ES quarterly future, rolling <=2 days before expiry."""
    if Future is None or ib_client is None:
        return None
    try:
        details = await ib_client.reqContractDetailsAsync(Future(symbol='ES', exchange='CME', currency='USD'))
        if not details:
            return None
        today_et = datetime.now(ET_TZ).strftime('%Y-%m-%d')
        candidates = []
        for d in details:
            c = d.contract
            exp_raw = str(getattr(c, 'lastTradeDateOrContractMonth', '') or '')
            if len(exp_raw) < 8:
                continue
            exp_iso = f"{exp_raw[:4]}-{exp_raw[4:6]}-{exp_raw[6:8]}"
            mult = str(getattr(c, 'multiplier', '') or '')
            if mult and mult != '50':
                continue
            candidates.append((exp_iso, c))
        if not candidates:
            return None
        candidates.sort(key=lambda item: item[0])
        cutoff_iso = (pd.Timestamp(today_et) + pd.Timedelta(days=2)).strftime('%Y-%m-%d')
        chosen = None
        for exp_iso, c in candidates:
            if exp_iso >= cutoff_iso:
                chosen = c
                break
        if chosen is None:
            chosen = candidates[-1][1]
        await ib_client.qualifyContractsAsync(chosen)
        return chosen
    except Exception as e:
        print(f"[IBKR] Warning: Failed to resolve ES futures contract: {e}")
        return None


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
    state.ndx_contract = Index('NDX', 'NASDAQ', 'USD')
    state.vxn_contract = Index('VXN', 'CBOE', 'USD')

    print("[IBKR] Qualifying index contracts (SPX, VIX, VIX3M, NDX, VXN) & resolving ES future...")
    _, state.es_contract = await asyncio.gather(
        state.ib.qualifyContractsAsync(state.spx_contract, state.vix_contract, state.ndx_contract, state.vxn_contract),
        resolve_front_es_contract(state.ib)
    )
    try:
        await state.ib.qualifyContractsAsync(state.vix3m_contract)
    except Exception:
        print("  VIX3M qualification failed. Trying legacy symbol VXV...")
        state.vix3m_contract = Index('VXV', 'CBOE', 'USD')
        await state.ib.qualifyContractsAsync(state.vix3m_contract)

    print(f" SPX: conId={state.spx_contract.conId}, symbol={state.spx_contract.symbol}")
    print(f" VIX: conId={state.vix_contract.conId}, symbol={state.vix_contract.symbol}")
    print(f" VIX3M: conId={state.vix3m_contract.conId}, symbol={state.vix3m_contract.symbol}")
    print(f" NDX: conId={state.ndx_contract.conId}, symbol={state.ndx_contract.symbol}")
    print(f" VXN: conId={state.vxn_contract.conId}, symbol={state.vxn_contract.symbol}")
    if state.es_contract:
        print(f" ES: conId={state.es_contract.conId}, localSymbol={state.es_contract.localSymbol}, exp={state.es_contract.lastTradeDateOrContractMonth}")
    else:
        print(" ES: Unavailable (GTH ES+VIX monitoring disabled)")

    # 2. Fetch Historical Bars (Spot-Vol, Intraday 1D, Weekly 5D, Macro 1Y, Intraday Correlation)
    await refresh_historical_data()

    # 3. Subscribe to Real-Time Streaming Tickers
    print("[IBKR] Subscribing to live market data streams (SPX, VIX, VIX3M, NDX, VXN, ES)...")
    state.spx_ticker = state.ib.reqMktData(state.spx_contract, '', False, False)
    state.vix_ticker = state.ib.reqMktData(state.vix_contract, '', False, False)
    state.vix3m_ticker = state.ib.reqMktData(state.vix3m_contract, '', False, False)
    state.ndx_ticker = state.ib.reqMktData(state.ndx_contract, '', False, False)
    state.vxn_ticker = state.ib.reqMktData(state.vxn_contract, '', False, False)
    if state.es_contract:
        state.es_ticker = state.ib.reqMktData(state.es_contract, '', False, False)

    for _ in range(10):
        await asyncio.sleep(0.2)
        p1, _ = get_current_price(state.spx_ticker, state.latest_spx_close)
        p2, _ = get_current_price(state.vix_ticker, state.latest_vix_close)
        p3, _ = get_current_price(state.vix3m_ticker, state.latest_vix3m_close)
        p4, _ = get_current_price(state.ndx_ticker, state.latest_ndx_close)
        p5, _ = get_current_price(state.vxn_ticker, state.latest_vxn_close)
        if p1 > 0 and p2 > 0 and p3 > 0 and p4 > 0 and p5 > 0:
            break

    print(" IBKR Engine initialized and streaming successfully.\n")
    return True


def bars_to_df(bars, col_name: str) -> pd.DataFrame:
    """
    Convert raw IBKR historical bars into a timezone-aware Eastern DataFrame with date, time, and day columns.
    """
    if not bars:
        return pd.DataFrame()
    try:
        df = util.df(bars)
        if df is None or df.empty or 'date' not in df.columns or 'close' not in df.columns:
            return pd.DataFrame()
        df['date'] = pd.to_datetime(df['date'])
        if df['date'].dt.tz is not None:
            df['date_et'] = df['date'].dt.tz_convert('US/Eastern')
        else:
            df['date_et'] = df['date'].dt.tz_localize('UTC').dt.tz_convert('US/Eastern')
        df['time'] = df['date_et'].dt.time
        df['day'] = df['date_et'].dt.date
        df = df.rename(columns={'close': col_name})
        return df[['date_et', 'time', 'day', col_name]]
    except Exception as e:
        print(f"[bars_to_df] Error parsing {col_name}: {e}")
        return pd.DataFrame()


def resample_30m_to_session(df: pd.DataFrame, target_size: str, col_name: str) -> pd.Series:
    """
    Resample 30-min bars to session-anchored 2-hour or 4-hour bars starting at 09:30 ET.
    Eliminates IBKR's clock-hour (:00) alignment distortion where 09:30 market open produces 30-min stubs.

    For 2h:
      - Block 1: 09:30 - 11:30 (times: 09:30, 10:00, 10:30, 11:00) -> '09:30'
      - Block 2: 11:30 - 13:30 (times: 11:30, 12:00, 12:30, 13:00) -> '11:30'
      - Block 3: 13:30 - 16:00 (times: 13:30, 14:00, 14:30, 15:00, 15:30) -> '13:30'
    For 4h:
      - Block 1: 09:30 - 13:30 (times: 09:30 to 13:00) -> '09:30'
      - Block 2: 13:30 - 16:00 (times: 13:30 to 15:30) -> '13:30'
    For 30m:
      - Cleanly filtered RTH bars with '%Y-%m-%d %H:%M' index.
    """
    if df is None or df.empty or col_name not in df.columns:
        return pd.Series(dtype=float, name=col_name)

    # Filter strictly to RTH (09:30 to 16:00 ET)
    df_rth = df[(df['time'] >= pd.to_datetime('09:30').time()) & (df['time'] < pd.to_datetime('16:00').time())].copy()
    if df_rth.empty:
        return pd.Series(dtype=float, name=col_name)

    if target_size == '30m':
        df_rth['date_str'] = df_rth['date_et'].dt.strftime('%Y-%m-%d %H:%M')
        return df_rth.drop_duplicates(subset=['date_str']).set_index('date_str')[col_name]

    records = []
    for day, group in df_rth.groupby('day'):
        group = group.sort_values('date_et')
        if target_size == '2h':
            # Block 1: 09:30 - 11:30
            b1 = group[(group['time'] >= pd.to_datetime('09:30').time()) & (group['time'] < pd.to_datetime('11:30').time())]
            if not b1.empty:
                records.append({'date': b1['date_et'].iloc[0].strftime('%Y-%m-%d %H:%M'), col_name: float(b1[col_name].iloc[-1])})

            # Block 2: 11:30 - 13:30
            b2 = group[(group['time'] >= pd.to_datetime('11:30').time()) & (group['time'] < pd.to_datetime('13:30').time())]
            if not b2.empty:
                records.append({'date': b2['date_et'].iloc[0].strftime('%Y-%m-%d %H:%M'), col_name: float(b2[col_name].iloc[-1])})

            # Block 3: 13:30 - 16:00 (afternoon session close)
            b3 = group[(group['time'] >= pd.to_datetime('13:30').time()) & (group['time'] < pd.to_datetime('16:00').time())]
            if not b3.empty:
                records.append({'date': b3['date_et'].iloc[0].strftime('%Y-%m-%d %H:%M'), col_name: float(b3[col_name].iloc[-1])})

        elif target_size == '4h':
            # Block 1: 09:30 - 13:30 (4h)
            b1 = group[(group['time'] >= pd.to_datetime('09:30').time()) & (group['time'] < pd.to_datetime('13:30').time())]
            if not b1.empty:
                records.append({'date': b1['date_et'].iloc[0].strftime('%Y-%m-%d %H:%M'), col_name: float(b1[col_name].iloc[-1])})

            # Block 2: 13:30 - 16:00 (2.5h)
            b2 = group[(group['time'] >= pd.to_datetime('13:30').time()) & (group['time'] < pd.to_datetime('16:00').time())]
            if not b2.empty:
                records.append({'date': b2['date_et'].iloc[0].strftime('%Y-%m-%d %H:%M'), col_name: float(b2[col_name].iloc[-1])})

    if not records:
        return pd.Series(dtype=float, name=col_name)
    res_df = pd.DataFrame(records).drop_duplicates(subset=['date']).set_index('date')
    return res_df[col_name]


def safe_to_series(bars, col_name: str) -> pd.Series:
    if not bars:
        return pd.Series(dtype=float, name=col_name)
    try:
        records = []
        for b in bars:
            dt = b.date
            if hasattr(dt, 'hour'):
                # Intraday datetime: normalize across CBOE and NASDAQ to US/Eastern
                dt_obj = pd.to_datetime(dt)
                if dt_obj.tz is None:
                    dt_obj = dt_obj.tz_localize('UTC')
                dt_ny = dt_obj.tz_convert('America/New_York')
                t_str = dt_ny.strftime('%Y-%m-%d %H:%M')
            else:
                # Daily date string
                t_str = str(dt)[:10]
            records.append({'date': t_str, col_name: float(b.close)})
        df = pd.DataFrame(records).drop_duplicates(subset=['date']).set_index('date')
        return df[col_name]
    except Exception as e:
        print(f"[safe_to_series] Error parsing {col_name}: {e}")
        return pd.Series(dtype=float, name=col_name)


def load_history_cache() -> Optional[Dict[str, Any]]:
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, 'rb') as f:
                data = pickle.load(f)
                if isinstance(data, dict) and 'dfs_pool' in data and 'df_daily' in data:
                    return data
        except Exception as e:
            print(f"[Cache Error] Failed reading history cache: {e}")
    return None


def save_history_cache(dfs_pool: Dict[str, pd.DataFrame], df_daily: pd.DataFrame, cache_date: str):
    try:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        payload = {
            'cache_date': cache_date,
            'dfs_pool': dfs_pool,
            'df_daily': df_daily
        }
        with open(CACHE_PATH, 'wb') as f:
            pickle.dump(payload, f)
        print(f"[Cache Saved] Deep multi-timeframe history saved to disk ({os.path.getsize(CACHE_PATH) / 1024:.1f} KB, date={cache_date})")
    except Exception as e:
        print(f"[Cache Error] Failed saving history cache: {e}")


def build_horizon_pack(s_bars, v_bars, v3_bars, n_bars, vx_bars, roll_win=20, min_p=5):
    df_s = s_bars if isinstance(s_bars, pd.Series) else safe_to_series(s_bars, 'spx')
    df_v = v_bars if isinstance(v_bars, pd.Series) else safe_to_series(v_bars, 'vix')
    df_v3 = v3_bars if isinstance(v3_bars, pd.Series) else safe_to_series(v3_bars, 'vix3m')
    df_n = n_bars if isinstance(n_bars, pd.Series) else safe_to_series(n_bars, 'ndx')
    df_vx = vx_bars if isinstance(vx_bars, pd.Series) else safe_to_series(vx_bars, 'vxn')

    # Term Structure
    df_ts = pd.concat([df_v, df_v3], axis=1).dropna()
    if not df_ts.empty:
        df_ts['ratio'] = df_ts['vix'] / df_ts['vix3m']

    # SPX / VIX Corr
    df_sv = pd.concat([df_s, df_v], axis=1).dropna()
    corr_val = -0.75
    if not df_sv.empty:
        ref_s = float(df_sv['spx'].iloc[0])
        ref_v = float(df_sv['vix'].iloc[0])
        df_sv['spx_pct'] = (df_sv['spx'] - ref_s) / ref_s * 100.0
        df_sv['vix_pt'] = df_sv['vix'] - ref_v
        # Always compute on log returns: Δ ln(S_t) vs Δ ln(VIX_t)
        df_sv['spx_ret'] = np.log(df_sv['spx'] / df_sv['spx'].shift(1))
        df_sv['vix_ret'] = np.log(df_sv['vix'] / df_sv['vix'].shift(1))
        df_sv['rolling_corr'] = df_sv['spx_ret'].rolling(roll_win, min_periods=min_p).corr(df_sv['vix_ret']).fillna(-0.75)
        corr_val = float(df_sv['rolling_corr'].iloc[-1])

    # NDX / VXN Corr
    df_nv = pd.concat([df_n, df_vx], axis=1).dropna()
    corr_ndx_val = -0.75
    if not df_nv.empty:
        ref_n = float(df_nv['ndx'].iloc[0])
        ref_vx = float(df_nv['vxn'].iloc[0])
        df_nv['ndx_pct'] = (df_nv['ndx'] - ref_n) / ref_n * 100.0
        df_nv['vxn_pt'] = df_nv['vxn'] - ref_vx
        # Always compute on log returns: Δ ln(NDX_t) vs Δ ln(VXN_t)
        df_nv['ndx_ret'] = np.log(df_nv['ndx'] / df_nv['ndx'].shift(1))
        df_nv['vxn_ret'] = np.log(df_nv['vxn'] / df_nv['vxn'].shift(1))
        df_nv['rolling_corr'] = df_nv['ndx_ret'].rolling(roll_win, min_periods=min_p).corr(df_nv['vxn_ret']).fillna(-0.75)
        corr_ndx_val = float(df_nv['rolling_corr'].iloc[-1])

    # Tech Vol Spread & Ratio
    df_tv = pd.concat([df_vx, df_v], axis=1).dropna()
    if not df_tv.empty:
        df_tv['spread'] = df_tv['vxn'] - df_tv['vix']
        df_tv['ratio'] = df_tv['vxn'] / df_tv['vix']

    return df_ts, df_sv, df_nv, df_tv, corr_val, corr_ndx_val


def build_from_daily_df(df_pool: pd.DataFrame, roll_win=20, min_p=5):
    if df_pool.empty:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), -0.75, -0.75
    # Term Structure
    df_ts = df_pool[['vix', 'vix3m']].copy()
    df_ts['ratio'] = df_ts['vix'] / df_ts['vix3m']

    # SPX / VIX Corr
    df_sv = df_pool[['spx', 'vix']].copy()
    ref_s = float(df_sv['spx'].iloc[0])
    ref_v = float(df_sv['vix'].iloc[0])
    df_sv['spx_pct'] = (df_sv['spx'] - ref_s) / ref_s * 100.0
    df_sv['vix_pt'] = df_sv['vix'] - ref_v
    # Always compute on log returns: Δ ln(S_t) vs Δ ln(VIX_t)
    df_sv['spx_ret'] = np.log(df_sv['spx'] / df_sv['spx'].shift(1))
    df_sv['vix_ret'] = np.log(df_sv['vix'] / df_sv['vix'].shift(1))
    df_sv['rolling_corr'] = df_sv['spx_ret'].rolling(roll_win, min_periods=min_p).corr(df_sv['vix_ret']).fillna(-0.75)
    corr_val = float(df_sv['rolling_corr'].iloc[-1])

    # NDX / VXN Corr
    df_nv = df_pool[['ndx', 'vxn']].copy()
    ref_n = float(df_nv['ndx'].iloc[0])
    ref_vx = float(df_nv['vxn'].iloc[0])
    df_nv['ndx_pct'] = (df_nv['ndx'] - ref_n) / ref_n * 100.0
    df_nv['vxn_pt'] = df_nv['vxn'] - ref_vx
    # Always compute on log returns: Δ ln(NDX_t) vs Δ ln(VXN_t)
    df_nv['ndx_ret'] = np.log(df_nv['ndx'] / df_nv['ndx'].shift(1))
    df_nv['vxn_ret'] = np.log(df_nv['vxn'] / df_nv['vxn'].shift(1))
    df_nv['rolling_corr'] = df_nv['ndx_ret'].rolling(roll_win, min_periods=min_p).corr(df_nv['vxn_ret']).fillna(-0.75)
    corr_ndx_val = float(df_nv['rolling_corr'].iloc[-1])

    # Tech Vol Spread & Ratio
    df_tv = df_pool[['vxn', 'vix']].copy()
    df_tv['spread'] = df_tv['vxn'] - df_tv['vix']
    df_tv['ratio'] = df_tv['vxn'] / df_tv['vix']

    return df_ts, df_sv, df_nv, df_tv, corr_val, corr_ndx_val


def classify_market_window(now_et: datetime) -> Dict[str, Any]:
    """Classify Eastern Time market hours across Cash RTH, CBOE VIX GTH, and CME ES Globex."""
    wd = now_et.weekday()  # 0=Mon .. 6=Sun
    t = now_et.time()

    is_es_window = False
    if wd < 4:  # Mon-Thu: Globex pauses daily 17:00-18:00 ET
        is_es_window = not (dtime(17, 0) <= t < dtime(18, 0))
    elif wd == 4:  # Fri: closes 17:00 ET
        is_es_window = (t < dtime(17, 0))
    elif wd == 6:  # Sun: opens 18:00 ET
        is_es_window = (t >= dtime(18, 0))

    is_rth_window = (wd < 5) and (dtime(9, 30) <= t < dtime(16, 0))
    is_vix_gth_window = (wd < 5) and (
        (dtime(3, 15) <= t < dtime(9, 15)) or (dtime(16, 0) <= t < dtime(16, 15))
    )
    vix_opens_at = "09:30 ET" if ((wd < 5) and (dtime(9, 15) <= t < dtime(9, 30))) else "03:15 ET"

    return {
        "is_rth_window": is_rth_window,
        "is_vix_gth_window": is_vix_gth_window,
        "is_es_window": is_es_window,
        "vix_opens_at": vix_opens_at,
    }


def filter_cboe_vix_gth(series_vix: pd.Series) -> pd.Series:
    """Keep strictly active CBOE VIX printing minutes (03:15-09:15 and 09:30-16:15 ET)."""
    if series_vix is None or series_vix.empty:
        return pd.Series(dtype=float, name='vix')
    mask = []
    for k in series_vix.index:
        s = str(k)
        hhmm = s[11:16] if len(s) >= 16 else ""
        active = (('03:15' <= hhmm < '09:15') or ('09:30' <= hhmm < '16:15'))
        mask.append(active)
    res = series_vix[mask].copy()
    res.name = 'vix'
    return res


def compute_basis_maps(
    s_spx_daily: pd.Series,
    s_vix_daily: pd.Series,
    s_es_daily: pd.Series,
    s_spx_intraday: pd.Series,
    s_es_intraday: pd.Series,
    s_vix_intraday: pd.Series,
    now_et: datetime,
) -> Dict[str, Any]:
    """
    Build official RTH closing Settlement Basis (ES_RTH_close - SPX_RTH_close) per session date.
    Never treats today's partial intraday daily bar (< 16:00 ET) as a closing settlement.
    Uses median of the final 5 cash RTH minutes as fallback immediately after 16:00 ET.
    """
    today_et = now_et.strftime('%Y-%m-%d')
    rth_finished_today = (now_et.time() >= dtime(16, 0))

    def to_completed_map(s: pd.Series) -> Dict[str, float]:
        out: Dict[str, float] = {}
        if s is None or s.empty:
            return out
        for k, v in s.items():
            d_str = str(k)[:10]
            if d_str < today_et or (d_str == today_et and rth_finished_today):
                if pd.notna(v) and float(v) > 0:
                    out[d_str] = float(v)
        return out

    spx_map = to_completed_map(s_spx_daily)
    vix_map = to_completed_map(s_vix_daily)
    es_map = to_completed_map(s_es_daily)

    basis_map: Dict[str, float] = {}
    basis_src_map: Dict[str, str] = {}
    for d_str in sorted(set(spx_map.keys()) & set(es_map.keys())):
        basis_map[d_str] = round(es_map[d_str] - spx_map[d_str], 4)
        basis_src_map[d_str] = "RTH Settlement"

    # Fallback: intraday RTH tail (15:55-15:59 or final 5 overlapping RTH bars) for completed days lacking daily settlement
    if s_spx_intraday is not None and not s_spx_intraday.empty:
        spx_dates = sorted(set(str(k)[:10] for k in s_spx_intraday.index))
        for d_str in spx_dates:
            if not (d_str < today_et or (d_str == today_et and rth_finished_today)):
                continue
            s_day = s_spx_intraday.loc[[str(k)[:10] == d_str for k in s_spx_intraday.index]]
            if not s_day.empty and d_str not in spx_map:
                spx_map[d_str] = float(s_day.iloc[-1])

            if s_vix_intraday is not None and not s_vix_intraday.empty and d_str not in vix_map:
                v_day = s_vix_intraday.loc[[(str(k)[:10] == d_str and '09:30' <= str(k)[11:16] < '16:15') for k in s_vix_intraday.index]]
                if not v_day.empty:
                    vix_map[d_str] = float(v_day.iloc[-1])

            if s_es_intraday is not None and not s_es_intraday.empty and d_str not in basis_map:
                es_rth = s_es_intraday.loc[[(str(k)[:10] == d_str and '09:30' <= str(k)[11:16] < '16:00') for k in s_es_intraday.index]]
                joined = pd.concat([s_day, es_rth], axis=1).dropna()
                if not joined.empty:
                    tail = joined.tail(5)
                    basis_map[d_str] = round(float(np.median(tail['es'] - tail['spx'])), 4)
                    basis_src_map[d_str] = "RTH Tail Median"
                    if d_str not in es_map:
                        es_map[d_str] = float(es_rth.iloc[-1])

    sorted_basis_dates = sorted(basis_map.keys())
    latest_completed_date = sorted_basis_dates[-1] if sorted_basis_dates else None
    return {
        "spx_map": spx_map,
        "vix_map": vix_map,
        "es_map": es_map,
        "basis_map": basis_map,
        "basis_src_map": basis_src_map,
        "sorted_basis_dates": sorted_basis_dates,
        "latest_completed_date": latest_completed_date,
    }


def _prior_basis_for_date(d_str: str, basis_map: Dict[str, float], sorted_basis_dates: List[str]) -> Optional[float]:
    prev_dates = [d for d in sorted_basis_dates if d < d_str]
    if prev_dates:
        return basis_map[prev_dates[-1]]
    if sorted_basis_dates:
        return basis_map[sorted_basis_dates[0]]
    return None


def build_gth_stitched_df(
    s_spx: pd.Series,
    s_vix_gth: pd.Series,
    s_es_gth: pd.Series,
    basis_map: Dict[str, float],
    sorted_basis_dates: List[str],
    spx_close_map: Dict[str, float],
    vix_close_map: Dict[str, float],
    is_1d: bool = True,
    roll_win: int = 30,
    min_p: int = 10,
) -> Dict[str, Any]:
    """
    Stitch active CBOE GTH VIX bars (03:15-09:15 & 16:00-16:15) with basis-adjusted ES
    and native cash SPX RTH bars (09:30-16:00).
    For 03:15-09:15 on date D, subtracts prior session basis(D-1).
    For 16:00-16:15 curb on date D, subtracts same-day basis(D).
    """
    empty_res = {
        "df": pd.DataFrame(),
        "session_date": None,
        "ref_spx": 0.0,
        "ref_vix": 0.0,
        "rolling_corr": -0.75,
    }
    if s_vix_gth is None or s_vix_gth.empty:
        return empty_res

    s_vix_clean = filter_cboe_vix_gth(s_vix_gth).sort_index()
    if s_vix_clean.empty:
        return empty_res

    session_date = None
    if is_1d:
        session_date = str(s_vix_clean.index[-1])[:10]
        s_vix_clean = s_vix_clean.loc[[str(k)[:10] == session_date for k in s_vix_clean.index]]
        if s_vix_clean.empty:
            return empty_res

    s_spx_idx = s_spx.dropna().sort_index() if (s_spx is not None and not s_spx.empty) else pd.Series(dtype=float)
    s_es_idx = s_es_gth.dropna().sort_index() if (s_es_gth is not None and not s_es_gth.empty) else pd.Series(dtype=float)

    rows = []
    for k, vix_val in s_vix_clean.items():
        ts = str(k)
        d_str = ts[:10]
        hhmm = ts[11:16]
        prior_basis = _prior_basis_for_date(d_str, basis_map, sorted_basis_dates)
        eod_basis = basis_map.get(d_str, prior_basis)

        if '09:30' <= hhmm < '16:00' and ts in s_spx_idx.index:
            spx_val = float(s_spx_idx.loc[ts])
            is_gth_bar = 0
        elif '16:00' <= hhmm < '16:15':
            if ts not in s_es_idx.index or eod_basis is None:
                continue
            spx_val = float(s_es_idx.loc[ts]) - float(eod_basis)
            is_gth_bar = 1
        else:
            if ts not in s_es_idx.index or prior_basis is None:
                continue
            spx_val = float(s_es_idx.loc[ts]) - float(prior_basis)
            is_gth_bar = 1

        rows.append({
            "date": ts,
            "spx": spx_val,
            "vix": float(vix_val),
            "is_gth": int(is_gth_bar),
        })

    if not rows:
        return empty_res

    df = pd.DataFrame(rows).drop_duplicates(subset=['date']).set_index('date').sort_index()

    if is_1d and session_date:
        prev_spx_dates = [d for d in sorted(spx_close_map.keys()) if d < session_date]
        prev_vix_dates = [d for d in sorted(vix_close_map.keys()) if d < session_date]
        ref_s = float(spx_close_map[prev_spx_dates[-1]]) if prev_spx_dates else float(df['spx'].iloc[0])
        ref_v = float(vix_close_map[prev_vix_dates[-1]]) if prev_vix_dates else float(df['vix'].iloc[0])
    else:
        ref_s = float(df['spx'].iloc[0])
        ref_v = float(df['vix'].iloc[0])

    df['spx_pct'] = (df['spx'] - ref_s) / ref_s * 100.0
    df['vix_pt'] = df['vix'] - ref_v
    df['spx_ret'] = np.log(df['spx'] / df['spx'].shift(1))
    df['vix_ret'] = np.log(df['vix'] / df['vix'].shift(1))
    df['rolling_corr'] = df['spx_ret'].rolling(roll_win, min_periods=min_p).corr(df['vix_ret']).fillna(-0.75)

    return {
        "df": df,
        "session_date": session_date,
        "ref_spx": ref_s,
        "ref_vix": ref_v,
        "rolling_corr": float(df['rolling_corr'].iloc[-1]),
    }


def compute_gth_spotvol_baseline(
    df_daily: pd.DataFrame,
    s_spx_d: pd.Series,
    s_vix_d: pd.Series,
    gth_target_date: Optional[str],
    now_et: datetime,
):
    """Compute Spot-Vol regression parameters strictly prior to gth_target_date using up-to-date daily closes."""
    base_df = pd.DataFrame(columns=['spx', 'vix'])
    if df_daily is not None and not df_daily.empty:
        col_spx = 'spx_close' if 'spx_close' in df_daily.columns else 'spx'
        col_vix = 'vix_close' if 'vix_close' in df_daily.columns else 'vix'
        if col_spx in df_daily.columns and col_vix in df_daily.columns:
            base_df = df_daily[[col_spx, col_vix]].dropna().rename(columns={col_spx: 'spx', col_vix: 'vix'}).copy()
            base_df.index = [str(d)[:10] for d in base_df.index]

    fresh_df = pd.concat([s_spx_d, s_vix_d], axis=1).dropna() if (s_spx_d is not None and not s_spx_d.empty and s_vix_d is not None and not s_vix_d.empty) else pd.DataFrame()
    if not fresh_df.empty:
        fresh_df.index = [str(d)[:10] for d in fresh_df.index]
        today_et = now_et.strftime('%Y-%m-%d')
        if now_et.time() < dtime(16, 0):
            fresh_df = fresh_df.loc[[d < today_et for d in fresh_df.index]]
        for d_idx, row in fresh_df.iterrows():
            base_df.loc[d_idx, ['spx', 'vix']] = [float(row['spx']), float(row['vix'])]

    base_df = base_df.sort_index()
    if gth_target_date:
        base_df = base_df.loc[[d < gth_target_date for d in base_df.index]]

    if len(base_df) < 3:
        state.df_spotvol_gth = state.df_spotvol.copy()
        state.gth_slope = state.slope
        state.gth_intercept = state.intercept
        state.gth_r_squared = state.r_squared
        state.gth_vol_slope = state.vol_slope
        return

    df_sv = base_df.rename(columns={'spx': 'spx_close', 'vix': 'vix_close'}).copy()
    df_sv['spx_pct'] = df_sv['spx_close'].pct_change() * 100.0
    df_sv['vix_pt'] = df_sv['vix_close'].diff()
    df_sv = df_sv.dropna()
    state.df_spotvol_gth = df_sv.iloc[-state.window_days:].copy()

    x = state.df_spotvol_gth['spx_pct'].values
    y = state.df_spotvol_gth['vix_pt'].values
    slope, intercept, r_val, _, _ = stats.linregress(x, y)
    state.gth_slope = float(slope)
    state.gth_intercept = float(intercept)
    state.gth_r_squared = float(r_val ** 2)
    state.gth_vol_slope = float(1.0 / slope) if slope != 0 else 0.0


def compute_spotvol_baselines(df_daily: pd.DataFrame, active_sess_date: Optional[str], today_et: str):
    col_spx = 'spx_close' if 'spx_close' in df_daily.columns else 'spx'
    col_vix = 'vix_close' if 'vix_close' in df_daily.columns else 'vix'
    df_sv = df_daily[[col_spx, col_vix]].dropna().rename(columns={col_spx: 'spx_close', col_vix: 'vix_close'})

    if active_sess_date:
        df_prior_sv = df_sv.loc[[str(d)[:10] < active_sess_date for d in df_sv.index]]
        if df_prior_sv.empty:
            df_prior_sv = df_sv.iloc[:-1] if len(df_sv) > 1 else df_sv
    else:
        is_today_in_sv = (str(df_sv.index[-1])[:10] == today_et) if not df_sv.empty else False
        df_prior_sv = df_sv.iloc[:-1] if is_today_in_sv and len(df_sv) > 1 else df_sv

    df_prior_sv = df_prior_sv.copy()
    df_prior_sv['spx_pct'] = df_prior_sv['spx_close'].pct_change() * 100.0
    df_prior_sv['vix_pt'] = df_prior_sv['vix_close'].diff()
    df_prior_sv = df_prior_sv.dropna()

    state.df_spotvol = df_prior_sv.iloc[-state.window_days:].copy()

    x = state.df_spotvol['spx_pct'].values
    y = state.df_spotvol['vix_pt'].values
    slope, intercept, r_value, _, _ = stats.linregress(x, y)
    state.slope = float(slope)
    state.intercept = float(intercept)
    state.r_squared = float(r_value ** 2)
    state.vol_slope = float(1.0 / slope) if slope != 0 else 0.0

    state.latest_spx_close = float(state.df_spotvol['spx_close'].iloc[-1])
    state.latest_vix_close = float(state.df_spotvol['vix_close'].iloc[-1])
    state.prior_spx_close = float(state.df_spotvol['spx_close'].iloc[-2]) if len(state.df_spotvol) > 1 else state.latest_spx_close
    state.prior_vix_close = float(state.df_spotvol['vix_close'].iloc[-2]) if len(state.df_spotvol) > 1 else state.latest_vix_close
    state.last_sess_x = float(state.df_spotvol['spx_pct'].iloc[-1])
    state.last_sess_y = float(state.df_spotvol['vix_pt'].iloc[-1])

    # NDX / VXN Spot-Vol Baseline
    col_ndx = 'ndx_close' if 'ndx_close' in df_daily.columns else 'ndx'
    col_vxn = 'vxn_close' if 'vxn_close' in df_daily.columns else 'vxn'
    df_sv_ndx = df_daily[[col_ndx, col_vxn]].dropna().rename(columns={col_ndx: 'ndx_close', col_vxn: 'vxn_close'})

    if active_sess_date:
        df_prior_ndx = df_sv_ndx.loc[[str(d)[:10] < active_sess_date for d in df_sv_ndx.index]]
        if df_prior_ndx.empty:
            df_prior_ndx = df_sv_ndx.iloc[:-1] if len(df_sv_ndx) > 1 else df_sv_ndx
    else:
        is_today_in_ndx = (str(df_sv_ndx.index[-1])[:10] == today_et) if not df_sv_ndx.empty else False
        df_prior_ndx = df_sv_ndx.iloc[:-1] if is_today_in_ndx and len(df_sv_ndx) > 1 else df_sv_ndx

    df_prior_ndx = df_prior_ndx.copy()
    df_prior_ndx['ndx_pct'] = df_prior_ndx['ndx_close'].pct_change() * 100.0
    df_prior_ndx['vxn_pt'] = df_prior_ndx['vxn_close'].diff()
    df_prior_ndx = df_prior_ndx.dropna()

    state.df_spotvol_ndx = df_prior_ndx.iloc[-state.window_days:].copy()

    x_ndx = state.df_spotvol_ndx['ndx_pct'].values
    y_ndx = state.df_spotvol_ndx['vxn_pt'].values
    ndx_slope, ndx_intercept, ndx_r_val, _, _ = stats.linregress(x_ndx, y_ndx)
    state.ndx_slope = float(ndx_slope)
    state.ndx_intercept = float(ndx_intercept)
    state.ndx_r_squared = float(ndx_r_val ** 2)
    state.ndx_vol_slope = float(1.0 / ndx_slope) if ndx_slope != 0 else 0.0

    state.latest_ndx_close = float(state.df_spotvol_ndx['ndx_close'].iloc[-1])
    state.latest_vxn_close = float(state.df_spotvol_ndx['vxn_close'].iloc[-1])
    state.prior_ndx_close = float(state.df_spotvol_ndx['ndx_close'].iloc[-2]) if len(state.df_spotvol_ndx) > 1 else state.latest_ndx_close
    state.prior_vxn_close = float(state.df_spotvol_ndx['vxn_close'].iloc[-2]) if len(state.df_spotvol_ndx) > 1 else state.latest_vxn_close
    state.prior_tech_spread_close = state.latest_vxn_close - state.latest_vix_close
    state.prior_tech_ratio_close = (state.latest_vxn_close / state.latest_vix_close) if state.latest_vix_close > 0 else 1.0
    state.last_sess_ndx_x = float(state.df_spotvol_ndx['ndx_pct'].iloc[-1])
    state.last_sess_ndx_y = float(state.df_spotvol_ndx['vxn_pt'].iloc[-1])

    print(f" SPX Spot-Vol Baseline ({len(state.df_spotvol)} bars): R²={state.r_squared:.4f}, Slope={state.slope:.4f}")
    print(f" NDX Spot-Vol Baseline ({len(state.df_spotvol_ndx)} bars): R²={state.ndx_r_squared:.4f}, Slope={state.ndx_slope:.4f}")


def apply_multi_timeframe_pool(dfs_pool: Dict[str, pd.DataFrame], df_daily: pd.DataFrame, active_sess_date: Optional[str], today_et: str):
    if not dfs_pool or 'spx' not in dfs_pool or dfs_pool['spx'].empty:
        return

    trading_days = sorted(dfs_pool['spx']['day'].unique()) if not dfs_pool['spx'].empty else []
    days_3m = set(trading_days[-64:]) if len(trading_days) >= 64 else set(trading_days)
    days_1m = set(trading_days[-22:]) if len(trading_days) >= 22 else set(trading_days)

    # 1M Bars (RTH 30-min bars for last 22 trading days)
    s_1m = resample_30m_to_session(dfs_pool['spx'][dfs_pool['spx']['day'].isin(days_1m)], '30m', 'spx')
    v_1m = resample_30m_to_session(dfs_pool['vix'][dfs_pool['vix']['day'].isin(days_1m)], '30m', 'vix')
    v3_1m = resample_30m_to_session(dfs_pool['vix3m'][dfs_pool['vix3m']['day'].isin(days_1m)], '30m', 'vix3m')
    n_1m = resample_30m_to_session(dfs_pool['ndx'][dfs_pool['ndx']['day'].isin(days_1m)], '30m', 'ndx')
    vx_1m = resample_30m_to_session(dfs_pool['vxn'][dfs_pool['vxn']['day'].isin(days_1m)], '30m', 'vxn')
    (state.df_ts_1m, state.df_spx_vix_1m, state.df_ndx_vxn_1m,
     state.df_tech_vol_1m, state.corr_1m, state.corr_1m_ndx) = build_horizon_pack(
        s_1m, v_1m, v3_1m, n_1m, vx_1m, roll_win=39, min_p=10
    )

    # 3M Bars (RTH 30-min bars for last 64 trading days)
    s_3m = resample_30m_to_session(dfs_pool['spx'][dfs_pool['spx']['day'].isin(days_3m)], '30m', 'spx')
    v_3m = resample_30m_to_session(dfs_pool['vix'][dfs_pool['vix']['day'].isin(days_3m)], '30m', 'vix')
    v3_3m = resample_30m_to_session(dfs_pool['vix3m'][dfs_pool['vix3m']['day'].isin(days_3m)], '30m', 'vix3m')
    n_3m = resample_30m_to_session(dfs_pool['ndx'][dfs_pool['ndx']['day'].isin(days_3m)], '30m', 'ndx')
    vx_3m = resample_30m_to_session(dfs_pool['vxn'][dfs_pool['vxn']['day'].isin(days_3m)], '30m', 'vxn')
    (state.df_ts_3m, state.df_spx_vix_3m, state.df_ndx_vxn_3m,
     state.df_tech_vol_3m, state.corr_3m, state.corr_3m_ndx) = build_horizon_pack(
        s_3m, v_3m, v3_3m, n_3m, vx_3m, roll_win=130, min_p=20
    )

    # 6M Bars (RTH 30-min bars for all available trading days)
    s_6m = resample_30m_to_session(dfs_pool['spx'], '30m', 'spx')
    v_6m = resample_30m_to_session(dfs_pool['vix'], '30m', 'vix')
    v3_6m = resample_30m_to_session(dfs_pool['vix3m'], '30m', 'vix3m')
    n_6m = resample_30m_to_session(dfs_pool['ndx'], '30m', 'ndx')
    vx_6m = resample_30m_to_session(dfs_pool['vxn'], '30m', 'vxn')
    (state.df_ts_6m, state.df_spx_vix_6m, state.df_ndx_vxn_6m,
     state.df_tech_vol_6m, state.corr_6m, state.corr_6m_ndx) = build_horizon_pack(
        s_6m, v_6m, v3_6m, n_6m, vx_6m, roll_win=195, min_p=30
    )

    # Daily Macro Horizons (MAX, 1Y, YTD)
    if not df_daily.empty:
        state.df_daily = df_daily

        # MAX
        (state.df_ts_max, state.df_spx_vix_max, state.df_ndx_vxn_max,
         state.df_tech_vol_max, state.corr_max, state.corr_max_ndx) = build_from_daily_df(
            state.df_daily, roll_win=60, min_p=20
        )

        # 1Y
        df_1y_pool = state.df_daily.iloc[-252:] if len(state.df_daily) >= 252 else state.df_daily
        (state.df_ts_1y, state.df_spx_vix_1y, state.df_ndx_vxn_1y,
         state.df_tech_vol_1y, state.corr_1y, state.corr_1y_ndx) = build_from_daily_df(
            df_1y_pool, roll_win=60, min_p=15
        )

        # YTD
        active_year = str(active_sess_date)[:4] if active_sess_date else datetime.now().strftime('%Y')
        df_ytd_pool = state.df_daily.loc[[str(d)[:4] == active_year for d in state.df_daily.index]]
        if df_ytd_pool.empty:
            df_ytd_pool = state.df_daily.iloc[-60:]
        (state.df_ts_ytd, state.df_spx_vix_ytd, state.df_ndx_vxn_ytd,
         state.df_tech_vol_ytd, state.corr_ytd, state.corr_ytd_ndx) = build_from_daily_df(
            df_ytd_pool, roll_win=20, min_p=5
        )

        if active_sess_date:
            df_1y_comp = state.df_ts_1y.loc[[str(d)[:10] < active_sess_date for d in state.df_ts_1y.index]]
            if df_1y_comp.empty:
                df_1y_comp = state.df_ts_1y.iloc[:-1] if len(state.df_ts_1y) > 1 else state.df_ts_1y
        else:
            is_today_in_1y = (str(state.df_ts_1y.index[-1])[:10] == today_et) if not state.df_ts_1y.empty else False
            df_1y_comp = state.df_ts_1y.iloc[:-1] if is_today_in_1y and len(state.df_ts_1y) > 1 else state.df_ts_1y

        if not df_1y_comp.empty:
            state.latest_vix3m_close = float(df_1y_comp['vix3m'].iloc[-1])
            state.prior_vix3m_close = float(df_1y_comp['vix3m'].iloc[-2]) if len(df_1y_comp) > 1 else state.latest_vix3m_close
            state.prior_ratio_close = (state.latest_vix_close / state.latest_vix3m_close) if state.latest_vix3m_close > 0 else 1.0


async def hydrate_deep_history_background(active_sess_date: Optional[str], today_et: str):
    """
    Background worker that fetches 6M (30-min) and 2Y (1-day) bars from IBKR,
    persists them to disk cache (history_cache.pkl), updates state multi-timeframe horizons,
    and bumps state.hist_version so connected browser clients receive updated datasets without UI blocking.
    """
    try:
        print("[Background Cache] Hydrating deep history (6M 30-min & 2Y daily) from IBKR in background...")
        (b6m_spx, b6m_vix, b6m_vix3m, b6m_ndx, b6m_vxn,
         spx_bars_2y, vix_bars_2y, vix3m_bars_2y, ndx_bars_2y, vxn_bars_2y) = await asyncio.gather(
            state.ib.reqHistoricalDataAsync(state.spx_contract, '', '6 M', '30 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '6 M', '30 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix3m_contract, '', '6 M', '30 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.ndx_contract, '', '6 M', '30 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vxn_contract, '', '6 M', '30 mins', 'TRADES', True, 1),

            state.ib.reqHistoricalDataAsync(state.spx_contract, '', '2 Y', '1 day', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '2 Y', '1 day', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix3m_contract, '', '2 Y', '1 day', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.ndx_contract, '', '2 Y', '1 day', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vxn_contract, '', '2 Y', '1 day', 'TRADES', True, 1),
        )
        dfs_pool = {
            name: bars_to_df(bars, name)
            for name, bars in zip(['spx', 'vix', 'vix3m', 'ndx', 'vxn'],
                                  [b6m_spx, b6m_vix, b6m_vix3m, b6m_ndx, b6m_vxn])
        }
        df_s2y = safe_to_series(spx_bars_2y, 'spx')
        df_v2y = safe_to_series(vix_bars_2y, 'vix')
        df_v32y = safe_to_series(vix3m_bars_2y, 'vix3m')
        df_n2y = safe_to_series(ndx_bars_2y, 'ndx')
        df_vx2y = safe_to_series(vxn_bars_2y, 'vxn')
        df_daily = pd.concat([df_s2y, df_v2y, df_v32y, df_n2y, df_vx2y], axis=1).dropna()

        # Save to disk cache
        save_history_cache(dfs_pool, df_daily, today_et)

        # Apply to state and bump hist_version
        apply_multi_timeframe_pool(dfs_pool, df_daily, active_sess_date, today_et)
        compute_spotvol_baselines(df_daily, active_sess_date, today_et)

        state.hist_version += 1
        print(f"[Background Cache] Deep history successfully hydrated and saved to disk. (Version {state.hist_version})")
    except Exception as e:
        print(f"[Background Cache Error] Failed hydrating deep history: {e}")


async def _empty_bars():
    return []


async def refresh_historical_data():
    """
    Fetch historical daily and intraday bars directly from IBKR for SPX, VIX, VIX3M, NDX, VXN, and ES
    across all 8 supported multi-timeframe horizons + GTH (ES Basis-Adjusted + Spot VIX):
      - 1D / 1D_GTH: 1-minute intraday bars
      - 5D / 5D_GTH: 5-minute weekly bars
      - 1M, 3M, 6M, YTD, 1Y, MAX: Loaded instantly from disk cache (<0.01s) or hydrated in background
    """
    print("[IBKR] Fetching historical baseline & multi-timeframe datasets (Fast Startup + GTH)...")
    try:
        has_es = (state.es_contract is not None)
        # 1. Fetch Intraday 1D/2D (1-min), 5D (5-min), & 1M daily settlement bars in parallel
        (b2_spx, b2_vix_gth, b1_vix3m, b1_ndx, b1_vxn,
         b5_spx, b5_vix, b5_vix3m, b5_ndx, b5_vxn,
         b5_vix_gth, b_spx_d, b_vix_d,
         b2_es, b5_es, b_es_d) = await asyncio.gather(
            state.ib.reqHistoricalDataAsync(state.spx_contract, '', '2 D', '1 min', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '2 D', '1 min', 'TRADES', False, 1),
            state.ib.reqHistoricalDataAsync(state.vix3m_contract, '', '1 D', '1 min', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.ndx_contract, '', '1 D', '1 min', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vxn_contract, '', '1 D', '1 min', 'TRADES', True, 1),

            state.ib.reqHistoricalDataAsync(state.spx_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix3m_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.ndx_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vxn_contract, '', '5 D', '5 mins', 'TRADES', True, 1),

            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '5 D', '5 mins', 'TRADES', False, 1),
            state.ib.reqHistoricalDataAsync(state.spx_contract, '', '1 M', '1 day', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '1 M', '1 day', 'TRADES', True, 1),

            state.ib.reqHistoricalDataAsync(state.es_contract, '', '2 D', '1 min', 'TRADES', False, 1) if has_es else _empty_bars(),
            state.ib.reqHistoricalDataAsync(state.es_contract, '', '5 D', '5 mins', 'TRADES', False, 1) if has_es else _empty_bars(),
            state.ib.reqHistoricalDataAsync(state.es_contract, '', '1 M', '1 day', 'TRADES', True, 1) if has_es else _empty_bars(),
        )

        # Pre-market / GTH Session Synchronization:
        now_et = datetime.now(ET_TZ)
        today_et = now_et.strftime('%Y-%m-%d')
        is_rth_now = (now_et.weekday() < 5) and (dtime(9, 30) <= now_et.time() < dtime(16, 15))
        win_info = classify_market_window(now_et)

        df_s2 = safe_to_series(b2_spx, 'spx')
        df_n1_raw = util.df(b1_ndx) if b1_ndx else None
        active_sess_date = None
        if not df_s2.empty:
            active_sess_date = str(df_s2.index[-1])[:10]
        elif df_n1_raw is not None and not df_n1_raw.empty and 'date' in df_n1_raw.columns:
            active_sess_date = str(df_n1_raw['date'].iloc[-1])[:10]

        if is_rth_now and (not active_sess_date or active_sess_date < today_et):
            active_sess_date = today_et

        state.active_session_date = active_sess_date

        df_s1 = df_s2.loc[[str(k)[:10] == active_sess_date for k in df_s2.index]] if (active_sess_date and not df_s2.empty) else pd.Series(dtype=float, name='spx')

        s_vix_2d_gth = safe_to_series(b2_vix_gth, 'vix')
        if active_sess_date and not s_vix_2d_gth.empty:
            df_v1 = s_vix_2d_gth.loc[[
                (str(k)[:10] == active_sess_date and '09:30' <= str(k)[11:16] < '16:15')
                for k in s_vix_2d_gth.index
            ]]
            df_v1.name = 'vix'
        else:
            df_v1 = pd.Series(dtype=float, name='vix')

        if active_sess_date and df_v1.empty:
            clean_dt = active_sess_date.replace('-', '')
            b1_vix_fb = await state.ib.reqHistoricalDataAsync(
                state.vix_contract, endDateTime=f"{clean_dt} 23:00:00", durationStr='1 D',
                barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
            )
            df_v1 = safe_to_series(b1_vix_fb, 'vix')

        # 2. Check disk cache for multi-timeframe pools
        cache_data = load_history_cache()
        need_background_hydration = False
        daily_ref_df = pd.DataFrame()

        if cache_data and 'dfs_pool' in cache_data and 'df_daily' in cache_data and not cache_data['df_daily'].empty:
            print("[IBKR] Loading deep multi-timeframe history from local disk cache (<0.01s)...")
            cached_dfs = cache_data['dfs_pool']
            cached_df_daily = cache_data['df_daily']
            daily_ref_df = cached_df_daily
            compute_spotvol_baselines(cached_df_daily, active_sess_date, today_et)
            apply_multi_timeframe_pool(cached_dfs, cached_df_daily, active_sess_date, today_et)
            if cache_data.get('cache_date') < today_et:
                need_background_hydration = True
        else:
            # Cold first launch with no disk cache: fetch 4M (1-day) bars in parallel (~0.25s) for immediate Spot-Vol baselines
            print("[IBKR] No disk cache found. Fetching 4M daily baseline for instant startup...")
            (spx_d, vix_d, vix3m_d, ndx_d, vxn_d) = await asyncio.gather(
                state.ib.reqHistoricalDataAsync(state.spx_contract, '', '4 M', '1 day', 'TRADES', True, 1),
                state.ib.reqHistoricalDataAsync(state.vix_contract, '', '4 M', '1 day', 'TRADES', True, 1),
                state.ib.reqHistoricalDataAsync(state.vix3m_contract, '', '4 M', '1 day', 'TRADES', True, 1),
                state.ib.reqHistoricalDataAsync(state.ndx_contract, '', '4 M', '1 day', 'TRADES', True, 1),
                state.ib.reqHistoricalDataAsync(state.vxn_contract, '', '4 M', '1 day', 'TRADES', True, 1),
            )
            df_s4m = safe_to_series(spx_d, 'spx')
            df_v4m = safe_to_series(vix_d, 'vix')
            df_v34m = safe_to_series(vix3m_d, 'vix3m')
            df_n4m = safe_to_series(ndx_d, 'ndx')
            df_vx4m = safe_to_series(vxn_d, 'vxn')
            df_daily_init = pd.concat([df_s4m, df_v4m, df_v34m, df_n4m, df_vx4m], axis=1).dropna()
            state.df_daily = df_daily_init
            daily_ref_df = df_daily_init
            compute_spotvol_baselines(df_daily_init, active_sess_date, today_et)
            need_background_hydration = True

        if need_background_hydration:
            asyncio.create_task(hydrate_deep_history_background(active_sess_date, today_et))

        # 2B. Compute ES-SPX Official Settlement Basis & Stitch 1D_GTH / 5D_GTH
        s_spx_d = safe_to_series(b_spx_d, 'spx')
        s_vix_d = safe_to_series(b_vix_d, 'vix')
        s_es_d = safe_to_series(b_es_d, 'es')
        s_es_2d = safe_to_series(b2_es, 'es')
        s_es_5d = safe_to_series(b5_es, 'es')
        s_vix_5d_gth = safe_to_series(b5_vix_gth, 'vix')

        basis_info = compute_basis_maps(s_spx_d, s_vix_d, s_es_d, df_s2, s_es_2d, s_vix_2d_gth, now_et)
        basis_map = basis_info["basis_map"]
        spx_map = basis_info["spx_map"]
        vix_map = basis_info["vix_map"]
        es_map = basis_info["es_map"]
        sorted_basis_dates = basis_info["sorted_basis_dates"]
        latest_comp_date = basis_info["latest_completed_date"]

        state.daily_basis_map = basis_map
        state.daily_spx_close_map = spx_map
        state.daily_es_close_map = es_map
        state.daily_vix_close_map = vix_map
        state.es_daily_df = pd.DataFrame({'es': s_es_d}) if not s_es_d.empty else pd.DataFrame()

        if latest_comp_date:
            state.eod_spx_close = spx_map.get(latest_comp_date)
            state.eod_es_close = es_map.get(latest_comp_date)
            state.eod_vix_close = vix_map.get(latest_comp_date)
            state.eod_es_spx_basis = basis_map.get(latest_comp_date)
            state.es_spx_basis = state.eod_es_spx_basis
            state.es_basis_source = basis_info["basis_src_map"].get(latest_comp_date, "")
            state.es_basis_date = latest_comp_date
            state.latest_es_close = float(es_map.get(latest_comp_date, 0.0) or 0.0)
            if now_et.time() >= dtime(16, 15) and latest_comp_date == today_et and state.es_basis_source == "RTH Settlement":
                state.last_eod_basis_sync_date = today_et

        gth_1d_pack = build_gth_stitched_df(
            df_s2, s_vix_2d_gth, s_es_2d, basis_map, sorted_basis_dates, spx_map, vix_map,
            is_1d=True, roll_win=30, min_p=10
        )
        state.df_spx_vix_1d_gth = gth_1d_pack["df"]
        state.gth_session_date = gth_1d_pack["session_date"]
        state.gth_ref_spx = gth_1d_pack["ref_spx"]
        state.gth_ref_vix = gth_1d_pack["ref_vix"]
        state.current_rolling_corr_gth = gth_1d_pack["rolling_corr"]

        gth_5d_pack = build_gth_stitched_df(
            safe_to_series(b5_spx, 'spx'), s_vix_5d_gth, s_es_5d, basis_map, sorted_basis_dates, spx_map, vix_map,
            is_1d=False, roll_win=78, min_p=20
        )
        state.df_spx_vix_5d_gth = gth_5d_pack["df"]
        state.corr_5d_gth = gth_5d_pack["rolling_corr"]

        if win_info["is_vix_gth_window"] and dtime(3, 15) <= now_et.time() < dtime(9, 30):
            gth_target_date = today_et
        else:
            gth_target_date = state.gth_session_date or active_sess_date
        compute_gth_spotvol_baseline(daily_ref_df, s_spx_d, s_vix_d, gth_target_date, now_et)
        state.last_gth_bar_refresh_ts = time.time()

        # 3. Process Intraday 1D Bars (1-min)
        df_v3 = safe_to_series(b1_vix3m, 'vix3m')
        df_1d = pd.concat([df_v1, df_v3], axis=1).dropna()
        if not df_1d.empty:
            df_1d['ratio'] = df_1d['vix'] / df_1d['vix3m']
            state.df_ts_1d = df_1d.copy()
            state.intraday_open_ratio = float(state.df_ts_1d['ratio'].iloc[0])
            state.intraday_high_ratio = float(state.df_ts_1d['ratio'].max())
            state.intraday_low_ratio = float(state.df_ts_1d['ratio'].min())
        else:
            state.df_ts_1d = pd.DataFrame(columns=['vix', 'vix3m', 'ratio'])

        df_sv_1d = pd.concat([df_s1, df_v1], axis=1).dropna()
        if not df_sv_1d.empty:
            ref_spx = state.latest_spx_close if state.latest_spx_close > 0 else float(df_sv_1d['spx'].iloc[0])
            ref_vix = state.latest_vix_close if state.latest_vix_close > 0 else float(df_sv_1d['vix'].iloc[0])
            df_sv_1d['spx_pct'] = (df_sv_1d['spx'] - ref_spx) / ref_spx * 100.0
            df_sv_1d['vix_pt'] = df_sv_1d['vix'] - ref_vix
            # Always compute on log returns: Δ ln(S_t) vs Δ ln(VIX_t) to prevent spurious non-stationarity
            df_sv_1d['spx_ret'] = np.log(df_sv_1d['spx'] / df_sv_1d['spx'].shift(1))
            df_sv_1d['vix_ret'] = np.log(df_sv_1d['vix'] / df_sv_1d['vix'].shift(1))
            df_sv_1d['rolling_corr'] = df_sv_1d['spx_ret'].rolling(30, min_periods=10).corr(df_sv_1d['vix_ret']).fillna(-0.75)
            state.df_spx_vix_1d = df_sv_1d.copy()
            state.current_rolling_corr = float(df_sv_1d['rolling_corr'].iloc[-1])
        else:
            state.df_spx_vix_1d = pd.DataFrame()

        df_n1 = safe_to_series(b1_ndx, 'ndx')
        df_vx1 = safe_to_series(b1_vxn, 'vxn')
        df_nv_1d = pd.concat([df_n1, df_vx1], axis=1).dropna()
        if not df_nv_1d.empty:
            ref_ndx = state.latest_ndx_close if state.latest_ndx_close > 0 else float(df_nv_1d['ndx'].iloc[0])
            ref_vxn = state.latest_vxn_close if state.latest_vxn_close > 0 else float(df_nv_1d['vxn'].iloc[0])
            df_nv_1d['ndx_pct'] = (df_nv_1d['ndx'] - ref_ndx) / ref_ndx * 100.0
            df_nv_1d['vxn_pt'] = df_nv_1d['vxn'] - ref_vxn
            # Always compute on log returns: Δ ln(NDX_t) vs Δ ln(VXN_t)
            df_nv_1d['ndx_ret'] = np.log(df_nv_1d['ndx'] / df_nv_1d['ndx'].shift(1))
            df_nv_1d['vxn_ret'] = np.log(df_nv_1d['vxn'] / df_nv_1d['vxn'].shift(1))
            df_nv_1d['rolling_corr'] = df_nv_1d['ndx_ret'].rolling(30, min_periods=10).corr(df_nv_1d['vxn_ret']).fillna(-0.75)
            state.df_ndx_vxn_1d = df_nv_1d.copy()
            state.current_rolling_corr_ndx = float(df_nv_1d['rolling_corr'].iloc[-1])
        else:
            state.df_ndx_vxn_1d = pd.DataFrame()

        df_tech_1d = pd.concat([df_vx1, df_v1], axis=1).dropna()
        if not df_tech_1d.empty:
            df_tech_1d['spread'] = df_tech_1d['vxn'] - df_tech_1d['vix']
            df_tech_1d['ratio'] = df_tech_1d['vxn'] / df_tech_1d['vix']
            state.df_tech_vol_1d = df_tech_1d.copy()
            state.tech_spread_low = float(df_tech_1d['spread'].min())
            state.tech_spread_high = float(df_tech_1d['spread'].max())
            state.tech_spread_open = float(df_tech_1d['spread'].iloc[0])
            state.tech_ratio_low = float(df_tech_1d['ratio'].min())
            state.tech_ratio_high = float(df_tech_1d['ratio'].max())
        else:
            state.df_tech_vol_1d = pd.DataFrame()

        # 4. Process 5D Bars (5-min)
        (state.df_ts_5d, state.df_spx_vix_5d, state.df_ndx_vxn_5d,
         state.df_tech_vol_5d, state.corr_5d, state.corr_5d_ndx) = build_horizon_pack(
            b5_spx, b5_vix, b5_vix3m, b5_ndx, b5_vxn, roll_win=78, min_p=20
        )

        state.hist_version += 1
        print(f"[IBKR] Baseline & multi-timeframe datasets successfully loaded (Version {state.hist_version}):")
        print(f"       1D={len(state.df_ts_1d)} bars, 5D={len(state.df_ts_5d)} bars, 1M={len(state.df_ts_1m)} bars (30m), "
              f"3M={len(state.df_ts_3m)} bars (30m), 6M={len(state.df_ts_6m)} bars (30m), YTD={len(state.df_ts_ytd)} bars, "
              f"1Y={len(state.df_ts_1y)} bars, MAX={len(state.df_ts_max)} bars.")
        if state.es_contract:
            basis_str = f"{state.es_spx_basis:+.2f} ({state.es_basis_source} {state.es_basis_date})" if state.es_spx_basis is not None else "N/A"
            print(f"[GTH] ES={state.es_contract.localSymbol}, Basis={basis_str}, "
                  f"1D_GTH={len(state.df_spx_vix_1d_gth)} bars (session={state.gth_session_date}), 5D_GTH={len(state.df_spx_vix_5d_gth)} bars.")

    except Exception as ex:
        print(f"[IBKR Error] Historical data refresh failed: {ex}")


def compute_live_payload() -> Dict[str, Any]:
    """
    Compute full real-time snapshot of market prices, Overvix residuals,
    intraday term structure ratio stats, rolling correlation, master confluence signal,
    and ES-based Global Trading Hours (GTH) monitoring for SPX & VIX.
    """
    spx_curr, spx_src = get_current_price(state.spx_ticker, state.latest_spx_close)
    vix_curr, vix_src = get_current_price(state.vix_ticker, state.latest_vix_close)
    vix3m_curr, vix3m_src = get_current_price(state.vix3m_ticker, state.latest_vix3m_close)
    ndx_curr, ndx_src = get_current_price(state.ndx_ticker, state.latest_ndx_close)
    vxn_curr, vxn_src = get_current_price(state.vxn_ticker, state.latest_vxn_close)
    es_curr, es_src = get_current_price(state.es_ticker, state.eod_es_close or state.latest_es_close)

    now_et = datetime.now(ET_TZ)
    today_et = now_et.strftime('%Y-%m-%d')
    is_weekday = (now_et.weekday() < 5)
    win = classify_market_window(now_et)
    is_rth_time = win["is_rth_window"]

    # A live RTH trading session is active only during RTH hours AND when today's session has actually begun
    is_live_rth = is_rth_time and (
        ("LIVE" in spx_src or "LIVE" in ndx_src) or
        (state.active_session_date == today_et)
    )

    live_vix_val, live_vix_src = vix_curr, vix_src
    is_premarket_hour = is_weekday and (now_et.time() < dtime(9, 30))

    if is_live_rth:
        spx_base = state.latest_spx_close if state.latest_spx_close > 0 else spx_curr
        vix_base = state.latest_vix_close if state.latest_vix_close > 0 else vix_curr
        vix3m_base = state.latest_vix3m_close if state.latest_vix3m_close > 0 else vix3m_curr
        ndx_base = state.latest_ndx_close if state.latest_ndx_close > 0 else ndx_curr
        vxn_base = state.latest_vxn_close if state.latest_vxn_close > 0 else vxn_curr

        curr_x = ((spx_curr - spx_base) / spx_base) * 100.0 if spx_base > 0 else 0.0
        curr_y = vix_curr - vix_base
        vix3m_pt = vix3m_curr - vix3m_base

        curr_ndx_x = ((ndx_curr - ndx_base) / ndx_base) * 100.0 if ndx_base > 0 else 0.0
        curr_ndx_y = vxn_curr - vxn_base
        mode_tag = "LIVE TRADING (RTH)"
        session_status = "REGULAR_RTH"
    else:
        # Pre-Market, After-Hours, or Weekend/Closed:
        # Intraday RTH charts display the displayed session (state.active_session_date).
        # Pin current_point and RTH session levels to the official closing values of the displayed session
        # so the RTH beacon sits precisely at the tip of the trail.

        spx_base = state.latest_spx_close if state.latest_spx_close > 0 else (float(state.df_spx_vix_1d['spx'].iloc[0]) if not state.df_spx_vix_1d.empty else spx_curr)
        vix_base = state.latest_vix_close if state.latest_vix_close > 0 else (float(state.df_spx_vix_1d['vix'].iloc[0]) if not state.df_spx_vix_1d.empty else vix_curr)
        vix3m_base = state.latest_vix3m_close if state.latest_vix3m_close > 0 else (float(state.df_ts_1d['vix3m'].iloc[0]) if not state.df_ts_1d.empty else vix3m_curr)
        ndx_base = state.latest_ndx_close if state.latest_ndx_close > 0 else (float(state.df_ndx_vxn_1d['ndx'].iloc[0]) if not state.df_ndx_vxn_1d.empty else ndx_curr)
        vxn_base = state.latest_vxn_close if state.latest_vxn_close > 0 else (float(state.df_ndx_vxn_1d['vxn'].iloc[0]) if not state.df_ndx_vxn_1d.empty else vxn_curr)

        if not state.df_spx_vix_1d.empty:
            curr_x = float(state.df_spx_vix_1d['spx_pct'].iloc[-1])
            curr_y = float(state.df_spx_vix_1d['vix_pt'].iloc[-1])
            spx_curr = float(state.df_spx_vix_1d['spx'].iloc[-1])
            vix_curr = float(state.df_spx_vix_1d['vix'].iloc[-1])
        else:
            curr_x = ((spx_curr - spx_base) / spx_base * 100.0) if spx_base > 0 else state.last_sess_x
            curr_y = (vix_curr - vix_base) if vix_base > 0 else state.last_sess_y

        if not state.df_ts_1d.empty:
            vix3m_curr = float(state.df_ts_1d['vix3m'].iloc[-1])
            vix3m_pt = vix3m_curr - vix3m_base if vix3m_base > 0 else 0.0
        else:
            vix3m_pt = vix3m_curr - vix3m_base if vix3m_base > 0 else 0.0

        if not state.df_ndx_vxn_1d.empty:
            curr_ndx_x = float(state.df_ndx_vxn_1d['ndx_pct'].iloc[-1])
            curr_ndx_y = float(state.df_ndx_vxn_1d['vxn_pt'].iloc[-1])
            ndx_curr = float(state.df_ndx_vxn_1d['ndx'].iloc[-1])
            vxn_curr = float(state.df_ndx_vxn_1d['vxn'].iloc[-1])
        else:
            curr_ndx_x = ((ndx_curr - ndx_base) / ndx_base * 100.0) if ndx_base > 0 else state.last_sess_ndx_x
            curr_ndx_y = (vxn_curr - vxn_base) if vxn_base > 0 else state.last_sess_ndx_y

        if is_premarket_hour:
            mode_tag = f"PRE-MARKET (SESSION {state.active_session_date} CLOSE)"
            session_status = "PRE_MARKET"
        else:
            mode_tag = f"LATEST SESSION (CLOSED: {state.active_session_date})"
            session_status = "CLOSED"

    # SPX Overvix Calculations
    expected_vix_pt = state.intercept + state.slope * curr_x
    residual_pts = curr_y - expected_vix_pt
    is_overvixed = bool(residual_pts >= state.spx_threshold_pts)

    # NDX Over-VXN Calculations
    expected_vxn_pt = state.ndx_intercept + state.ndx_slope * curr_ndx_x
    residual_ndx_pts = curr_ndx_y - expected_vxn_pt
    is_overvxned = bool(residual_ndx_pts >= state.ndx_threshold_pts)

    # Term Structure Calculations (VIX / VIX3M)
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

    # Tech Vol Spread & Ratio (VXN - VIX & VXN / VIX)
    tech_spread = vxn_curr - vix_curr
    tech_ratio = float(vxn_curr / vix_curr) if vix_curr > 0 else 1.0
    tech_spread_change = tech_spread - state.prior_tech_spread_close if state.prior_tech_spread_close != 0 else 0.0

    # Intraday SPX-VIX Correlation Evaluation (Non-linear Regime Indicator, not a hedge ratio)
    corr_val = state.current_rolling_corr
    if corr_val <= -0.50:
        corr_status = "NORMAL INVERSE"
        corr_desc = "Healthy inverse spot-vol correlation (typical -0.70 to -0.85 regime indicator)."
        corr_badge = "HEALTHY"
    elif corr_val < 0.0:
        corr_status = "REGIME SHIFT (STRESS)"
        corr_desc = "Spot-vol correlation broke above -0.50: signals vol-of-vol stress, call-buying frenzies, or dealer repositioning."
        corr_badge = "STRESS"
    else:
        corr_status = "POSITIVE DECOUPLING"
        corr_desc = "Spot-vol decoupling: SPX and VIX moving in tandem (extreme stress / frenzy)!"
        corr_badge = "DECOUPLED"

    # Intraday NDX-VXN Correlation Evaluation
    corr_ndx_val = state.current_rolling_corr_ndx
    if corr_ndx_val <= -0.50:
        ndx_corr_status = "NORMAL INVERSE"
        ndx_corr_badge = "HEALTHY"
    elif corr_ndx_val < 0.0:
        ndx_corr_status = "REGIME SHIFT (STRESS)"
        ndx_corr_badge = "STRESS"
    else:
        ndx_corr_status = "POSITIVE DECOUPLING"
        ndx_corr_badge = "DECOUPLED"

    # Master Confluence Signals (SPX)
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

    # Master Confluence Signals (NDX)
    if is_overvxned and is_inverted:
        ndx_confluence_tag = "TECH CAPITULATION ALERT"
        ndx_confluence_desc = f"Extreme Tech Panic: NDX Over-VXN ({residual_ndx_pts:+.2f} pts) + Vol Term Structure Inverted"
    elif is_overvxned:
        ndx_confluence_tag = "OVER-VXN ALERT"
        ndx_confluence_desc = f"Tech Vol Shock: VXN is {residual_ndx_pts:+.2f} pts above NDX regression trendline."
    elif tech_spread >= 9.0 or tech_ratio >= 1.50:
        ndx_confluence_tag = "TECH PANIC SPREAD"
        ndx_confluence_desc = f"Acute Tech Vol Shock: VXN - VIX spread is +{tech_spread:.2f} pts ({tech_ratio:.3f}x ≥ 95th percentile panic threshold)."
    elif tech_spread >= 6.5 or tech_ratio >= 1.35:
        ndx_confluence_tag = "ELEVATED TECH SPREAD"
        ndx_confluence_desc = f"Elevated Tech Vol Premium: VXN - VIX spread is +{tech_spread:.2f} pts ({tech_ratio:.3f}x vs ~1.28x equilibrium)."
    else:
        ndx_confluence_tag = "NORMAL TECH REGIME"
        ndx_confluence_desc = f"Normal tech spot-vol pricing ({residual_ndx_pts:+.2f} pts). Tech vol spread: +{tech_spread:.2f} pts."

    curr_time_str = now_et.strftime('%H:%M:%S')
    curr_dt_str = now_et.strftime('%Y-%m-%d %H:%M')

    # GTH (ES Futures Basis-Adjusted + Spot VIX) State Classification & Computations
    es_sym = getattr(state.es_contract, 'localSymbol', 'ES') if state.es_contract else ""
    active_basis = state.eod_es_spx_basis if state.eod_es_spx_basis is not None else state.es_spx_basis
    gth_has_es = bool(state.es_contract is not None and es_curr > 0 and active_basis is not None)
    es_live_now = bool(gth_has_es and win["is_es_window"] and ("LIVE" in es_src))
    has_gth_hist = (not state.df_spx_vix_1d_gth.empty)

    if is_live_rth:
        gth_status = "REGULAR_RTH"
        gth_is_active = False
        gth_is_es_live = es_live_now
        gth_is_vix_live = ("LIVE" in live_vix_src)
        gth_syn_spx = round(es_curr - active_basis, 2) if gth_has_es else round(spx_curr, 2)
        gth_pct = round(curr_x, 2)
        gth_vix_val = round(vix_curr, 2)
        gth_vix_pt = round(curr_y, 2)
        gth_ref_s = round(spx_base, 2)
        gth_ref_v = round(vix_base, 2)
        gth_sess_date = state.gth_session_date or state.active_session_date
        gth_overvix = {
            "expected_vix_pt": round(expected_vix_pt, 2),
            "residual_pts": round(residual_pts, 2),
            "is_overvixed": is_overvixed,
            "status": "OVERVIXED" if is_overvixed else "NORMAL"
        }
        gth_curr_pt = {"x": round(curr_x, 2), "y": round(curr_y, 2)}
        gth_confluence = {
            "tag": confluence_tag,
            "description": confluence_desc,
            "is_dual_alert": is_dual_alert,
            "is_overvix_alert": is_overvix_alert
        }
        gth_vix_opens_at = None
    elif win["is_vix_gth_window"] and gth_has_es and (es_live_now or win["is_es_window"]):
        gth_status = "GTH_ACTIVE"
        gth_is_active = True
        gth_is_es_live = es_live_now
        gth_is_vix_live = ("LIVE" in live_vix_src) or (
            state.gth_session_date == today_et and has_gth_hist
        ) or (dtime(16, 0) <= now_et.time() < dtime(16, 15))

        if dtime(3, 15) <= now_et.time() < dtime(9, 15):
            # Morning pre-market GTH for today's upcoming cash session: reference yesterday's official RTH closes
            g_ref_spx = state.eod_spx_close if state.eod_spx_close else spx_base
            g_ref_vix = state.eod_vix_close if state.eod_vix_close else vix_base
            g_basis = active_basis
            g_slope = state.gth_slope if state.gth_slope is not None else state.slope
            g_intercept = state.gth_intercept if state.gth_intercept is not None else state.intercept
            g_vix_raw = live_vix_val if ("LIVE" in live_vix_src) else (
                float(state.df_spx_vix_1d_gth['vix'].iloc[-1])
                if (has_gth_hist and state.gth_session_date == today_et)
                else g_ref_vix
            )
            gth_sess_date = today_et
        else:
            # Afternoon curb GTH (16:00-16:15 ET) continuing today's session: reference prior day's closes & today's EOD basis
            g_ref_spx = spx_base
            g_ref_vix = vix_base
            g_basis = state.daily_basis_map.get(today_et, active_basis)
            g_slope = state.slope
            g_intercept = state.intercept
            g_vix_raw = live_vix_val if ("LIVE" in live_vix_src) else (
                float(state.df_spx_vix_1d_gth['vix'].iloc[-1])
                if (has_gth_hist and state.gth_session_date == today_et)
                else (state.eod_vix_close or vix_curr)
            )
            gth_sess_date = state.gth_session_date or state.active_session_date

        active_basis = g_basis
        syn_spx_raw = es_curr - float(g_basis)
        g_x = ((syn_spx_raw - g_ref_spx) / g_ref_spx) * 100.0 if g_ref_spx > 0 else 0.0
        g_y = g_vix_raw - g_ref_vix
        g_exp = g_intercept + g_slope * g_x
        g_res = g_y - g_exp
        g_over = bool(g_res >= state.spx_threshold_pts)

        gth_syn_spx = round(syn_spx_raw, 2)
        gth_pct = round(g_x, 2)
        gth_vix_val = round(g_vix_raw, 2)
        gth_vix_pt = round(g_y, 2)
        gth_ref_s = round(g_ref_spx, 2)
        gth_ref_v = round(g_ref_vix, 2)
        gth_vix_opens_at = None
        gth_overvix = {
            "expected_vix_pt": round(g_exp, 2),
            "residual_pts": round(g_res, 2),
            "is_overvixed": g_over,
            "status": "OVERVIXED" if g_over else "NORMAL"
        }
        gth_curr_pt = {"x": round(g_x, 2), "y": round(g_y, 2)}
        basis_op = f"- {g_basis:.2f}" if g_basis >= 0 else f"+ {abs(g_basis):.2f}"
        gth_confluence = {
            "tag": "GTH OVERVIX ALERT" if g_over else "GTH NORMAL REGIME",
            "description": (
                f"GTH Spot-Vol Shock: VIX {g_res:+.2f} pts above expected line ({es_sym} Synth SPX {gth_syn_spx:,.2f})."
                if g_over else
                f"GTH Monitoring Live ({es_sym} {basis_op} = {gth_syn_spx:,.2f} | VIX {gth_vix_val:.2f}, Res: {g_res:+.2f} pts). VIX3M at RTH close."
            ),
            "is_dual_alert": False,
            "is_overvix_alert": g_over
        }
        session_status = "GTH_ACTIVE"
        mode_tag = f"GTH LIVE ({es_sym} + VIX)"
    elif win["is_es_window"] and gth_has_es and es_live_now:
        # Overnight ES Globex (16:15-03:15 ET) or morning CBOE handover (09:15-09:30 ET):
        # ES is live, VIX is dormant -> stream Synthetic SPX, pause Overvix residuals cleanly!
        gth_status = "OVERNIGHT_ES_ONLY"
        gth_is_active = False
        gth_is_es_live = True
        gth_is_vix_live = False
        g_ref_spx = state.eod_spx_close if state.eod_spx_close else spx_curr
        g_ref_vix = state.eod_vix_close if state.eod_vix_close else vix_curr
        syn_spx_raw = es_curr - float(active_basis)
        g_x = ((syn_spx_raw - g_ref_spx) / g_ref_spx) * 100.0 if g_ref_spx > 0 else 0.0

        # During 09:15-09:30 handover, preserve last morning GTH VIX print; overnight uses prior close
        if dtime(9, 15) <= now_et.time() < dtime(9, 30) and has_gth_hist and state.gth_session_date == today_et:
            last_vix = float(state.df_spx_vix_1d_gth['vix'].iloc[-1])
            gth_vix_pt = round(last_vix - g_ref_vix, 2)
        else:
            last_vix = g_ref_vix
            gth_vix_pt = 0.0

        gth_syn_spx = round(syn_spx_raw, 2)
        gth_pct = round(g_x, 2)
        gth_vix_val = round(last_vix, 2)
        gth_ref_s = round(g_ref_spx, 2)
        gth_ref_v = round(g_ref_vix, 2)
        gth_sess_date = state.gth_session_date or state.active_session_date
        gth_vix_opens_at = win["vix_opens_at"]
        gth_overvix = {
            "expected_vix_pt": None,
            "residual_pts": None,
            "is_overvixed": False,
            "status": "PAUSED",
            "reason": f"Spot VIX closed (Opens {gth_vix_opens_at})"
        }
        gth_curr_pt = {"x": round(g_x, 2), "y": None}
        basis_op = f"- {active_basis:.2f}" if active_basis >= 0 else f"+ {abs(active_basis):.2f}"
        gth_confluence = {
            "tag": f"OVERNIGHT ES LIVE | VIX @ {gth_vix_opens_at}",
            "description": f"Synthetic SPX ({es_sym} {basis_op} = {gth_syn_spx:,.2f}, {gth_pct:+.2f}%) live. Spot VIX opens {gth_vix_opens_at} — Overvix residuals paused.",
            "is_dual_alert": False,
            "is_overvix_alert": False
        }
        session_status = "OVERNIGHT_ES_ONLY"
        mode_tag = f"OVERNIGHT ES LIVE ({es_sym} | VIX @ {gth_vix_opens_at})"
    else:
        gth_status = "CLOSED"
        gth_is_active = False
        gth_is_es_live = False
        gth_is_vix_live = False
        gth_vix_opens_at = win["vix_opens_at"]
        gth_sess_date = state.gth_session_date or state.active_session_date
        if has_gth_hist:
            last_row = state.df_spx_vix_1d_gth.iloc[-1]
            g_x = float(last_row['spx_pct'])
            g_y = float(last_row['vix_pt'])
            g_spx = float(last_row['spx'])
            g_vix = float(last_row['vix'])
            g_exp = state.intercept + state.slope * g_x
            g_res = g_y - g_exp
            g_over = bool(g_res >= state.spx_threshold_pts)
            gth_syn_spx = round(g_spx, 2)
            gth_pct = round(g_x, 2)
            gth_vix_val = round(g_vix, 2)
            gth_vix_pt = round(g_y, 2)
            gth_ref_s = round(state.gth_ref_spx or spx_base, 2)
            gth_ref_v = round(state.gth_ref_vix or vix_base, 2)
            gth_overvix = {
                "expected_vix_pt": round(g_exp, 2),
                "residual_pts": round(g_res, 2),
                "is_overvixed": g_over,
                "status": "OVERVIXED" if g_over else "NORMAL"
            }
            gth_curr_pt = {"x": round(g_x, 2), "y": round(g_y, 2)}
        else:
            gth_syn_spx = round(spx_curr, 2)
            gth_pct = round(curr_x, 2)
            gth_vix_val = round(vix_curr, 2)
            gth_vix_pt = round(curr_y, 2)
            gth_ref_s = round(spx_base, 2)
            gth_ref_v = round(vix_base, 2)
            gth_overvix = {
                "expected_vix_pt": round(expected_vix_pt, 2),
                "residual_pts": round(residual_pts, 2),
                "is_overvixed": is_overvixed,
                "status": "OVERVIXED" if is_overvixed else "NORMAL"
            }
            gth_curr_pt = {"x": round(curr_x, 2), "y": round(curr_y, 2)}
        gth_confluence = {
            "tag": confluence_tag,
            "description": confluence_desc,
            "is_dual_alert": is_dual_alert,
            "is_overvix_alert": is_overvix_alert
        }

    src_suffix = "" if is_live_rth else (" (PRE-MARKET)" if is_premarket_hour else " (CLOSED)")

    return {
        "timestamp": curr_time_str,
        "datetime": curr_dt_str,
        "session_date": state.active_session_date,
        "hist_version": state.hist_version,
        "mode": mode_tag,
        "is_rth_active": is_live_rth,
        "session_status": session_status,
        "premarket": {
            "is_premarket": is_premarket_hour,
            "gth_vix": round(live_vix_val, 2) if "LIVE" in live_vix_src else round(state.eod_vix_close or state.latest_vix_close, 2),
            "gth_vix_change": round(live_vix_val - (state.eod_vix_close or state.latest_vix_close), 2) if "LIVE" in live_vix_src else 0.0,
            "vix_source": live_vix_src,
            "session_date": state.active_session_date,
            "opens_at": "09:30 ET"
        },
        "gth": {
            "available": bool(gth_has_es or has_gth_hist),
            "session_status": gth_status,
            "is_gth_active": gth_is_active,
            "is_es_live": gth_is_es_live,
            "is_vix_live": gth_is_vix_live,
            "synthetic_spx": gth_syn_spx,
            "spx_pct_change": gth_pct,
            "es_price": round(es_curr, 2) if es_curr > 0 else None,
            "es_symbol": es_sym,
            "basis": round(active_basis, 2) if active_basis is not None else None,
            "basis_source": state.es_basis_source,
            "basis_date": state.es_basis_date,
            "vix": gth_vix_val,
            "vix_pt_change": gth_vix_pt,
            "vix_opens_at": gth_vix_opens_at,
            "ref_spx": gth_ref_s,
            "ref_vix": gth_ref_v,
            "session_date": gth_sess_date,
            "rolling_corr": round(state.current_rolling_corr_gth, 3),
            "corr_5d": round(state.corr_5d_gth, 3),
            "model": {
                "r_squared": round(state.gth_r_squared if (gth_status == "GTH_ACTIVE" and dtime(3, 15) <= now_et.time() < dtime(9, 30) and state.gth_r_squared is not None) else state.r_squared, 4),
                "slope": round(state.gth_slope if (gth_status == "GTH_ACTIVE" and dtime(3, 15) <= now_et.time() < dtime(9, 30) and state.gth_slope is not None) else state.slope, 4),
                "vol_slope": round(state.gth_vol_slope if (gth_status == "GTH_ACTIVE" and dtime(3, 15) <= now_et.time() < dtime(9, 30) and state.gth_vol_slope is not None) else state.vol_slope, 4),
                "intercept": round(state.gth_intercept if (gth_status == "GTH_ACTIVE" and dtime(3, 15) <= now_et.time() < dtime(9, 30) and state.gth_intercept is not None) else state.intercept, 4),
                "window_days": state.window_days,
                "threshold_pts": round(state.spx_threshold_pts, 2),
            },
            "overvix": gth_overvix,
            "current_point": gth_curr_pt,
            "confluence": gth_confluence,
        },
        "connection": {
            "connected": state.is_connected,
            "port": state.port,
            "clientId": state.client_id
        },
        "market": {
            "spx": {
                "current": round(spx_curr, 2),
                "pct_change": round(curr_x, 2),
                "source": spx_src if is_live_rth else f"SESSION CLOSE{src_suffix}"
            },
            "vix": {
                "current": round(vix_curr, 2),
                "pt_change": round(curr_y, 2),
                "source": vix_src if is_live_rth else f"SESSION CLOSE{src_suffix}"
            },
            "vix3m": {
                "current": round(vix3m_curr, 2),
                "pt_change": round(vix3m_pt, 2),
                "source": vix3m_src if is_live_rth else f"SESSION CLOSE{src_suffix}"
            }
        },
        "reference_closes": {
            "spx": round(state.latest_spx_close, 2),
            "vix": round(state.latest_vix_close, 2),
            "vix3m": round(state.latest_vix3m_close, 2),
            "ndx": round(state.latest_ndx_close, 2),
            "vxn": round(state.latest_vxn_close, 2),
        },
        "model": {
            "r_squared": round(state.r_squared, 4),
            "slope": round(state.slope, 4),
            "vol_slope": round(state.vol_slope, 4),
            "intercept": round(state.intercept, 4),
            "window_days": state.window_days,
            "threshold_pts": round(state.spx_threshold_pts, 2)
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
        },
        "ndx": {
            "market": {
                "current": round(ndx_curr, 2),
                "pct_change": round(curr_ndx_x, 2),
                "source": ndx_src if is_live_rth else f"SESSION CLOSE{src_suffix}",
                "vxn": {
                    "current": round(vxn_curr, 2),
                    "pt_change": round(curr_ndx_y, 2),
                    "source": vxn_src if is_live_rth else f"SESSION CLOSE{src_suffix}"
                }
            },
            "model": {
                "r_squared": round(state.ndx_r_squared, 4),
                "slope": round(state.ndx_slope, 4),
                "vol_slope": round(state.ndx_vol_slope, 4),
                "intercept": round(state.ndx_intercept, 4),
                "window_days": state.window_days,
                "threshold_pts": round(state.ndx_threshold_pts, 2)
            },
            "overvix": {
                "expected_vol_pt": round(expected_vxn_pt, 2),
                "residual_pts": round(residual_ndx_pts, 2),
                "is_overvixed": is_overvxned,
                "status": "OVER-VXN" if is_overvxned else "NORMAL"
            },
            "correlation": {
                "rolling_corr": round(corr_ndx_val, 3),
                "corr_5d": round(state.corr_5d_ndx, 3),
                "corr_1y": round(state.corr_1y_ndx, 3),
                "status": ndx_corr_status,
                "badge": ndx_corr_badge
            },
            "confluence": {
                "tag": ndx_confluence_tag,
                "description": ndx_confluence_desc,
                "is_overvixed": is_overvxned
            },
            "current_point": {
                "x": round(curr_ndx_x, 2),
                "y": round(curr_ndx_y, 2)
            }
        },
        "tech_vol": {
            "spread": round(tech_spread, 2),
            "ratio": round(tech_ratio, 4),
            "prior_spread": round(state.prior_tech_spread_close, 2),
            "prior_ratio": round(state.prior_tech_ratio_close, 4),
            "change_pts": round(tech_spread_change, 2),
            "intraday": {
                "low": round(state.tech_spread_low, 2),
                "high": round(state.tech_spread_high, 2),
                "open": round(state.tech_spread_open, 2),
                "ratio_low": round(state.tech_ratio_low, 4),
                "ratio_high": round(state.tech_ratio_high, 4)
            }
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
    last_hist_refresh = time.time()

    while True:
        try:
            await asyncio.sleep(state.interval)
            now = time.time()
            now_et = datetime.now(pytz.timezone('US/Eastern'))
            today_et = now_et.strftime('%Y-%m-%d')
            is_weekday = (now_et.weekday() < 5)

            # Auto-reconnect check if IBKR is offline
            if not state.is_connected or (state.ib and not state.ib.isConnected()):
                state.is_connected = False
                if now - last_reconnect_attempt >= 5.0:
                    last_reconnect_attempt = now
                    try:
                        await connect_and_init_ibkr(DEFAULT_IBKR_HOST, state.port, state.client_id)
                    except Exception as e:
                        print(f"[IBKR Reconnect] Still waiting for TWS/Gateway: {e}")

            # Check for GTH open (03:15 ET), RTH open (09:30 ET), 60s periodic bar sync during active hours, or post-close settlement sync
            if state.is_connected and state.ib and state.ib.isConnected():
                should_refresh = False
                win_loop = classify_market_window(now_et)
                # 03:15 ET GTH open transition for today's CBOE VIX pre-market session
                if is_weekday and (dtime(3, 15) <= now_et.time() < dtime(9, 15)) and (state.gth_session_date != today_et):
                    should_refresh = True
                # 09:30 ET RTH open transition when active session is still prior day
                elif is_weekday and (now_et.time() >= dtime(9, 30)) and (state.active_session_date != today_et):
                    should_refresh = True
                # Periodic refresh every 60s during RTH (09:30-16:00) OR CBOE GTH active windows (03:15-09:15 & 16:00-16:15)
                elif is_weekday and (win_loop["is_rth_window"] or win_loop["is_vix_gth_window"]) and (now - last_hist_refresh >= 60.0):
                    should_refresh = True
                # Post-close final sync: immediately after 16:00 ET, and once after 16:15 curb to capture daily settlement basis
                elif is_weekday and (now_et.time() >= dtime(16, 0)) and (last_hist_refresh < datetime.combine(now_et.date(), dtime(16, 0)).replace(tzinfo=ET_TZ).timestamp()):
                    should_refresh = True
                elif is_weekday and (now_et.time() >= dtime(16, 16)) and (state.last_eod_basis_sync_date != today_et):
                    should_refresh = True
                    state.last_eod_basis_sync_date = today_et

                if should_refresh:
                    last_hist_refresh = now
                    try:
                        print(f"[Intraday Sync] Refreshing historical data at {now_et.strftime('%H:%M:%S')} ET...")
                        await refresh_historical_data()
                    except Exception as e:
                        print(f"[Intraday Sync Error] {e}")

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
            if state.ndx_contract: state.ib.cancelMktData(state.ndx_contract)
            if state.vxn_contract: state.ib.cancelMktData(state.vxn_contract)
            if state.es_contract: state.ib.cancelMktData(state.es_contract)
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
      - 5D weekly 5-minute bars
      - 1Y macro daily bars
    """
    live = compute_live_payload()

    # Format Spot-Vol history (SPX)
    x_hist = [round(float(v), 2) for v in state.df_spotvol['spx_pct'].tolist()] if not state.df_spotvol.empty else []
    y_hist = [round(float(v), 2) for v in state.df_spotvol['vix_pt'].tolist()] if not state.df_spotvol.empty else []
    dates_sv = [str(d)[:10] for d in state.df_spotvol.index] if not state.df_spotvol.empty else []

    # Format Spot-Vol history (NDX)
    x_ndx_hist = [round(float(v), 2) for v in state.df_spotvol_ndx['ndx_pct'].tolist()] if not state.df_spotvol_ndx.empty else []
    y_ndx_hist = [round(float(v), 2) for v in state.df_spotvol_ndx['vxn_pt'].tolist()] if not state.df_spotvol_ndx.empty else []
    dates_ndx_sv = [str(d)[:10] for d in state.df_spotvol_ndx.index] if not state.df_spotvol_ndx.empty else []

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

    # Format Dynamic Correlation across all 8 multi-timeframe horizons
    def format_corr_df(df, col_x='spx_pct', col_y='vix_pt', is_daily=False):
        if df.empty or col_x not in df.columns or col_y not in df.columns:
            return {"times": [], "dates": [], "spx_pct": [], "vix_pt": [], "ndx_pct": [], "vxn_pt": [], "spot_raw": [], "vol_raw": [], "rolling_corr": []}
        if is_daily:
            times = [str(d)[:10] for d in df.index]
        else:
            times = to_eastern_dt_list(df.index)
        x_vals = [round(float(v), 2) for v in df[col_x].tolist()]
        y_vals = [round(float(v), 2) for v in df[col_y].tolist()]
        spot_raw = [round(float(v), 2) for v in df['spx'].tolist()] if 'spx' in df.columns else ([round(float(v), 2) for v in df['ndx'].tolist()] if 'ndx' in df.columns else [])
        vol_raw = [round(float(v), 2) for v in df['vix'].tolist()] if 'vix' in df.columns else ([round(float(v), 2) for v in df['vxn'].tolist()] if 'vxn' in df.columns else [])
        res = {
            "times": times,
            "dates": times,
            "spx_pct": x_vals,
            "vix_pt": y_vals,
            "ndx_pct": x_vals,
            "vxn_pt": y_vals,
            "spot_raw": spot_raw,
            "vol_raw": vol_raw,
            "rolling_corr": [round(float(v), 3) for v in df['rolling_corr'].tolist()] if 'rolling_corr' in df.columns else []
        }
        if 'spx' in df.columns:
            res["spx_raw"] = spot_raw
        if 'vix' in df.columns:
            res["vix_raw"] = vol_raw
        if 'ndx' in df.columns:
            res["ndx_raw"] = spot_raw
        if 'vxn' in df.columns:
            res["vxn_raw"] = vol_raw
        if 'is_gth' in df.columns:
            res["is_gth"] = [int(v) for v in df['is_gth'].tolist()]
        return res

    # Format SPX & VIX Correlation across 8 horizons (+ GTH-enabled 1D/5D)
    corr_1d = format_corr_df(state.df_spx_vix_1d, 'spx_pct', 'vix_pt')
    corr_1d_gth = format_corr_df(state.df_spx_vix_1d_gth, 'spx_pct', 'vix_pt')
    corr_5d = format_corr_df(state.df_spx_vix_5d, 'spx_pct', 'vix_pt')
    corr_5d_gth = format_corr_df(state.df_spx_vix_5d_gth, 'spx_pct', 'vix_pt')
    corr_1m = format_corr_df(state.df_spx_vix_1m, 'spx_pct', 'vix_pt')
    corr_3m = format_corr_df(state.df_spx_vix_3m, 'spx_pct', 'vix_pt')
    corr_6m = format_corr_df(state.df_spx_vix_6m, 'spx_pct', 'vix_pt')
    corr_ytd = format_corr_df(state.df_spx_vix_ytd, 'spx_pct', 'vix_pt', is_daily=True)
    corr_1y = format_corr_df(state.df_spx_vix_1y, 'spx_pct', 'vix_pt', is_daily=True)
    corr_max = format_corr_df(state.df_spx_vix_max, 'spx_pct', 'vix_pt', is_daily=True)

    # Format NDX & VXN Correlation across 8 horizons
    corr_ndx_1d = format_corr_df(state.df_ndx_vxn_1d, 'ndx_pct', 'vxn_pt')
    corr_ndx_5d = format_corr_df(state.df_ndx_vxn_5d, 'ndx_pct', 'vxn_pt')
    corr_ndx_1m = format_corr_df(state.df_ndx_vxn_1m, 'ndx_pct', 'vxn_pt')
    corr_ndx_3m = format_corr_df(state.df_ndx_vxn_3m, 'ndx_pct', 'vxn_pt')
    corr_ndx_6m = format_corr_df(state.df_ndx_vxn_6m, 'ndx_pct', 'vxn_pt')
    corr_ndx_ytd = format_corr_df(state.df_ndx_vxn_ytd, 'ndx_pct', 'vxn_pt', is_daily=True)
    corr_ndx_1y = format_corr_df(state.df_ndx_vxn_1y, 'ndx_pct', 'vxn_pt', is_daily=True)
    corr_ndx_max = format_corr_df(state.df_ndx_vxn_max, 'ndx_pct', 'vxn_pt', is_daily=True)

    # Format Term Structure across 8 horizons
    def format_ts_df(df, is_daily=False):
        if df.empty or 'vix' not in df.columns or 'vix3m' not in df.columns:
            return {"times": [], "dates": [], "vix": [], "vix3m": [], "ratio": []}
        if is_daily:
            times = [str(d)[:10] for d in df.index]
        else:
            times = to_eastern_dt_list(df.index)
        return {
            "times": times,
            "dates": times,
            "vix": [round(float(v), 2) for v in df['vix'].tolist()],
            "vix3m": [round(float(v), 2) for v in df['vix3m'].tolist()],
            "ratio": [round(float(v), 4) for v in df['ratio'].tolist()] if 'ratio' in df.columns else []
        }

    ts_1d = format_ts_df(state.df_ts_1d)
    ts_5d = format_ts_df(state.df_ts_5d)
    ts_1m = format_ts_df(state.df_ts_1m)
    ts_3m = format_ts_df(state.df_ts_3m)
    ts_6m = format_ts_df(state.df_ts_6m)
    ts_ytd = format_ts_df(state.df_ts_ytd, is_daily=True)
    ts_1y = format_ts_df(state.df_ts_1y, is_daily=True)
    ts_max = format_ts_df(state.df_ts_max, is_daily=True)

    # Format Tech Vol Spread & Ratio across 8 horizons
    def format_tech_vol_df(df, is_daily=False):
        if df.empty or 'spread' not in df.columns or 'ratio' not in df.columns:
            return {"times": [], "dates": [], "spread": [], "ratio": [], "vxn": [], "vix": []}
        if is_daily:
            times = [str(d)[:10] for d in df.index]
        else:
            times = to_eastern_dt_list(df.index)
        return {
            "times": times,
            "dates": times,
            "spread": [round(float(v), 2) for v in df['spread'].tolist()],
            "ratio": [round(float(v), 4) for v in df['ratio'].tolist()],
            "vxn": [round(float(v), 2) for v in df['vxn'].tolist()] if 'vxn' in df.columns else [],
            "vix": [round(float(v), 2) for v in df['vix'].tolist()] if 'vix' in df.columns else []
        }

    tech_vol_1d = format_tech_vol_df(state.df_tech_vol_1d)
    tech_vol_5d = format_tech_vol_df(state.df_tech_vol_5d)
    tech_vol_1m = format_tech_vol_df(state.df_tech_vol_1m)
    tech_vol_3m = format_tech_vol_df(state.df_tech_vol_3m)
    tech_vol_6m = format_tech_vol_df(state.df_tech_vol_6m)
    tech_vol_ytd = format_tech_vol_df(state.df_tech_vol_ytd, is_daily=True)
    tech_vol_1y = format_tech_vol_df(state.df_tech_vol_1y, is_daily=True)
    tech_vol_max = format_tech_vol_df(state.df_tech_vol_max, is_daily=True)

    # Attach datasets to live NDX and Tech Vol sub-objects
    ndx_bootstrap = {
        **live["ndx"],
        "overvix": {
            **live["ndx"]["overvix"],
            "x_history": x_ndx_hist,
            "y_history": y_ndx_hist,
            "dates": dates_ndx_sv,
            "intraday_trail": {
                "x": corr_ndx_1d["spx_pct"],
                "y": corr_ndx_1d["vix_pt"],
                "times": corr_ndx_1d["times"]
            }
        },
        "correlation": {
            **live["ndx"]["correlation"],
            "current_corr": round(state.current_rolling_corr_ndx, 3),
            "1D": corr_ndx_1d,
            "5D": corr_ndx_5d,
            "1M": corr_ndx_1m,
            "3M": corr_ndx_3m,
            "6M": corr_ndx_6m,
            "YTD": corr_ndx_ytd,
            "1Y": corr_ndx_1y,
            "MAX": corr_ndx_max,
            "metrics": {
                "1D": round(state.current_rolling_corr_ndx, 3),
                "5D": round(state.corr_5d_ndx, 3),
                "1M": round(state.corr_1m_ndx, 3),
                "3M": round(state.corr_3m_ndx, 3),
                "6M": round(state.corr_6m_ndx, 3),
                "YTD": round(state.corr_ytd_ndx, 3),
                "1Y": round(state.corr_1y_ndx, 3),
                "MAX": round(state.corr_max_ndx, 3)
            }
        },
        "intraday_correlation": {
            "times": corr_ndx_1d["times"],
            "spx_pct": corr_ndx_1d["spx_pct"],
            "vix_pt": corr_ndx_1d["vix_pt"],
            "rolling_corr": corr_ndx_1d["rolling_corr"],
            "current_corr": round(state.current_rolling_corr_ndx, 3),
            "1D": corr_ndx_1d,
            "5D": corr_ndx_5d,
            "1M": corr_ndx_1m,
            "3M": corr_ndx_3m,
            "6M": corr_ndx_6m,
            "YTD": corr_ndx_ytd,
            "1Y": corr_ndx_1y,
            "MAX": corr_ndx_max,
            "metrics": {
                "1D": round(state.current_rolling_corr_ndx, 3),
                "5D": round(state.corr_5d_ndx, 3),
                "1M": round(state.corr_1m_ndx, 3),
                "3M": round(state.corr_3m_ndx, 3),
                "6M": round(state.corr_6m_ndx, 3),
                "YTD": round(state.corr_ytd_ndx, 3),
                "1Y": round(state.corr_1y_ndx, 3),
                "MAX": round(state.corr_max_ndx, 3)
            }
        }
    }

    tech_vol_bootstrap = {
        **live["tech_vol"],
        "1D": tech_vol_1d,
        "5D": tech_vol_5d,
        "1M": tech_vol_1m,
        "3M": tech_vol_3m,
        "6M": tech_vol_6m,
        "YTD": tech_vol_ytd,
        "1Y": tech_vol_1y,
        "MAX": tech_vol_max,
        # Legacy aliases
        "intraday_1d": tech_vol_1d,
        "intraday_5d": tech_vol_5d,
        "history_1y": tech_vol_1y
    }

    x_gth_hist = [round(float(v), 2) for v in state.df_spotvol_gth['spx_pct'].tolist()] if not state.df_spotvol_gth.empty else x_hist
    y_gth_hist = [round(float(v), 2) for v in state.df_spotvol_gth['vix_pt'].tolist()] if not state.df_spotvol_gth.empty else y_hist
    dates_gth_sv = [str(d)[:10] for d in state.df_spotvol_gth.index] if not state.df_spotvol_gth.empty else dates_sv

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
            },
            "intraday_trail_gth": {
                "x": corr_1d_gth["spx_pct"],
                "y": corr_1d_gth["vix_pt"],
                "times": corr_1d_gth["times"],
                "is_gth": corr_1d_gth.get("is_gth", []),
                "session_date": state.gth_session_date
            },
            "gth_model": {
                **live["gth"]["model"],
                "x_history": x_gth_hist,
                "y_history": y_gth_hist,
                "dates": dates_gth_sv,
                "ref_spx": round(state.gth_ref_spx, 2) if state.gth_ref_spx else live["reference_closes"]["spx"],
                "ref_vix": round(state.gth_ref_vix, 2) if state.gth_ref_vix else live["reference_closes"]["vix"],
            }
        },
        "term_structure": {
            **live["term_structure"],
            "1D": ts_1d,
            "5D": ts_5d,
            "1M": ts_1m,
            "3M": ts_3m,
            "6M": ts_6m,
            "YTD": ts_ytd,
            "1Y": ts_1y,
            "MAX": ts_max,
            # Legacy aliases
            "intraday_1d": ts_1d,
            "intraday_5d": ts_5d,
            "history_1y": ts_1y
        },
        "intraday_correlation": {
            "times": corr_1d["times"],
            "spx_pct": corr_1d["spx_pct"],
            "vix_pt": corr_1d["vix_pt"],
            "rolling_corr": corr_1d["rolling_corr"],
            "current_corr": round(state.current_rolling_corr, 3),
            "1D": corr_1d,
            "1D_GTH": corr_1d_gth,
            "5D": corr_5d,
            "5D_GTH": corr_5d_gth,
            "1M": corr_1m,
            "3M": corr_3m,
            "6M": corr_6m,
            "YTD": corr_ytd,
            "1Y": corr_1y,
            "MAX": corr_max,
            "metrics": {
                "1D": round(state.current_rolling_corr, 3),
                "5D": round(state.corr_5d, 3),
                "1M": round(state.corr_1m, 3),
                "3M": round(state.corr_3m, 3),
                "6M": round(state.corr_6m, 3),
                "YTD": round(state.corr_ytd, 3),
                "1Y": round(state.corr_1y, 3),
                "MAX": round(state.corr_max, 3)
            },
            "metrics_gth": {
                "1D": round(state.current_rolling_corr_gth, 3),
                "5D": round(state.corr_5d_gth, 3),
            }
        },
        "ndx": ndx_bootstrap,
        "tech_vol": tech_vol_bootstrap
    }


@app.get("/api/status")
async def get_status():
    return compute_live_payload()


@app.get("/api/available-dates")
async def get_available_dates():
    """
    Return list of dates with pre-computed sessions on disk, available date range,
    and notable historical market regimes for 1-click inspection.
    """
    cached = get_cached_dates()
    min_date = ""
    max_date = ""
    if not state.df_daily.empty:
        idx = [str(d)[:10] for d in state.df_daily.index]
        min_date = idx[0]
        max_date = idx[-1]

    notable = load_notable_dates()

    return {
        "cached": cached,
        "min_date": min_date,
        "max_date": max_date,
        "notable": notable
    }


class NotableDateRequest(BaseModel):
    date: str
    label: Optional[str] = None


@app.post("/api/notable-dates")
async def add_notable_date_endpoint(req: NotableDateRequest):
    """Save a user-defined custom notable date preset to data/notable_dates.json."""
    if not req.date or len(req.date) != 10:
        return JSONResponse(status_code=400, content={"detail": "Invalid date format. Expected YYYY-MM-DD."})
    label = req.label.strip() if req.label and req.label.strip() else req.date
    updated = save_notable_date(req.date, label)
    return {"status": "ok", "notable": updated}


@app.get("/api/session")
async def get_historical_session(date: str):
    """
    Retrieve or fetch complete historical 1-minute intraday session replay for date (YYYY-MM-DD).
    Returns Spot-Vol trail, 1-min Term Structure, 1-min Dynamic Correlation, and model metrics.
    """
    if not date or len(date) != 10:
        return JSONResponse(status_code=400, content={"detail": "Invalid date format. Expected YYYY-MM-DD."})

    try:
        payload = await fetch_and_build_historical_session(
            ib=state.ib,
            spx_contract=state.spx_contract,
            vix_contract=state.vix_contract,
            vix3m_contract=state.vix3m_contract,
            df_daily=state.df_daily,
            target_date=date,
            threshold_pts=state.spx_threshold_pts,
            window_days=state.window_days,
            ndx_contract=state.ndx_contract,
            vxn_contract=state.vxn_contract,
            ndx_threshold_pts=state.ndx_threshold_pts
        )
        return payload
    except ValueError as ve:
        return JSONResponse(status_code=404, content={"detail": str(ve)})
    except Exception as ex:
        return JSONResponse(status_code=500, content={"detail": f"Failed fetching historical session: {str(ex)}"})


class ConfigRequest(BaseModel):
    threshold: Optional[float] = None
    spx_threshold: Optional[float] = None
    ndx_threshold: Optional[float] = None
    window: Optional[int] = None
    interval: Optional[float] = None


@app.post("/api/config")
async def post_config(req: ConfigRequest):
    if req.spx_threshold is not None:
        state.spx_threshold_pts = float(req.spx_threshold)
        state.threshold_pts = state.spx_threshold_pts
    elif req.threshold is not None:
        state.spx_threshold_pts = float(req.threshold)
        state.threshold_pts = state.spx_threshold_pts

    if req.ndx_threshold is not None:
        state.ndx_threshold_pts = float(req.ndx_threshold)

    if req.window is not None and req.window != state.window_days:
        state.window_days = int(req.window)
        await refresh_historical_data()
    if req.interval is not None:
        state.interval = max(0.2, float(req.interval))

    return {
        "status": "ok", 
        "spx_threshold": state.spx_threshold_pts,
        "ndx_threshold": state.ndx_threshold_pts,
        "threshold": state.spx_threshold_pts, 
        "window": state.window_days, 
        "interval": state.interval
    }


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
            url = f"http://localhost:{args.web_port}"
            # Poll /api/status until server is responsive before opening browser
            for _ in range(60):
                try:
                    with urllib.request.urlopen(f"{url}/api/status", timeout=0.5) as resp:
                        if resp.status == 200:
                            break
                except Exception:
                    time.sleep(0.15)
            print(f"[Dashboard] Opening web dashboard in browser: {url}")
            webbrowser.open(url)
        import threading
        threading.Thread(target=open_browser, daemon=True).start()

    print(f"[Dashboard] Running on http://127.0.0.1:{args.web_port}")
    uvicorn.run(app, host="127.0.0.1", port=args.web_port, log_level="warning")


if __name__ == '__main__':
    main()
