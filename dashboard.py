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
    from ib_async import IB, Index, util
except ImportError:
    try:
        from ib_insync import IB, Index, util
    except ImportError:
        IB = None
        Index = None
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

        # Tickers
        self.spx_ticker = None
        self.vix_ticker = None
        self.vix3m_ticker = None
        self.ndx_ticker = None
        self.vxn_ticker = None

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

    print("[IBKR] Qualifying index contracts (SPX, VIX, VIX3M, NDX, VXN)...")
    await state.ib.qualifyContractsAsync(state.spx_contract, state.vix_contract, state.ndx_contract, state.vxn_contract)
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

    # 2. Fetch Historical Bars (Spot-Vol, Intraday 1D, Weekly 5D, Macro 1Y, Intraday Correlation)
    await refresh_historical_data()

    # 3. Subscribe to Real-Time Streaming Tickers
    print("[IBKR] Subscribing to live market data streams (SPX, VIX, VIX3M, NDX, VXN)...")
    state.spx_ticker = state.ib.reqMktData(state.spx_contract, '', False, False)
    state.vix_ticker = state.ib.reqMktData(state.vix_contract, '', False, False)
    state.vix3m_ticker = state.ib.reqMktData(state.vix3m_contract, '', False, False)
    state.ndx_ticker = state.ib.reqMktData(state.ndx_contract, '', False, False)
    state.vxn_ticker = state.ib.reqMktData(state.vxn_contract, '', False, False)

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


async def refresh_historical_data():
    """
    Fetch historical daily and intraday bars directly from IBKR for SPX, VIX, VIX3M, NDX, VXN
    across all 8 supported multi-timeframe horizons:
      - 1D: 1-minute intraday bars (today's active session)
      - 5D: 5-minute weekly bars (~390 bars)
      - 1M, 3M, 6M, YTD, 1Y, MAX: Loaded instantly from disk cache (<0.01s) or hydrated in background
    """
    print("[IBKR] Fetching historical baseline & multi-timeframe datasets (Fast Startup)...")
    try:
        # 1. Fetch Intraday 1D (1-min) & 5D (5-min) bars in parallel
        (b1_spx, b1_vix, b1_vix3m, b1_ndx, b1_vxn,
         b5_spx, b5_vix, b5_vix3m, b5_ndx, b5_vxn) = await asyncio.gather(
            state.ib.reqHistoricalDataAsync(state.spx_contract, '', '1 D', '1 min', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '1 D', '1 min', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix3m_contract, '', '1 D', '1 min', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.ndx_contract, '', '1 D', '1 min', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vxn_contract, '', '1 D', '1 min', 'TRADES', True, 1),

            state.ib.reqHistoricalDataAsync(state.spx_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vix3m_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.ndx_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
            state.ib.reqHistoricalDataAsync(state.vxn_contract, '', '5 D', '5 mins', 'TRADES', True, 1),
        )

        # Pre-market / GTH Session Synchronization:
        now_et = datetime.now(pytz.timezone('US/Eastern'))
        today_et = now_et.strftime('%Y-%m-%d')
        is_rth_now = (now_et.weekday() < 5) and (dtime(9, 30) <= now_et.time() < dtime(16, 15))

        df_s1_raw = util.df(b1_spx) if b1_spx else None
        df_n1_raw = util.df(b1_ndx) if b1_ndx else None
        active_sess_date = None
        if df_s1_raw is not None and not df_s1_raw.empty and 'date' in df_s1_raw.columns:
            active_sess_date = str(df_s1_raw['date'].iloc[-1])[:10]
        elif df_n1_raw is not None and not df_n1_raw.empty and 'date' in df_n1_raw.columns:
            active_sess_date = str(df_n1_raw['date'].iloc[-1])[:10]

        if is_rth_now and (not active_sess_date or active_sess_date < today_et):
            active_sess_date = today_et

        state.active_session_date = active_sess_date

        if active_sess_date and not is_rth_now:
            df_v1_raw = util.df(b1_vix) if b1_vix else None
            if df_v1_raw is not None and not df_v1_raw.empty and 'date' in df_v1_raw.columns:
                vix_date = str(df_v1_raw['date'].iloc[-1])[:10]
                if vix_date != active_sess_date:
                    print(f"[Session Alignment] SPX/NDX are on session {active_sess_date}, but VIX returned pre-market GTH bars on {vix_date}. Aligning VIX to {active_sess_date} session close...")
                    clean_dt = active_sess_date.replace('-', '')
                    b1_vix = await state.ib.reqHistoricalDataAsync(
                        state.vix_contract, endDateTime=f"{clean_dt} 23:00:00", durationStr='1 D',
                        barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
                    )

        # 2. Check disk cache for multi-timeframe pools
        cache_data = load_history_cache()
        need_background_hydration = False

        if cache_data and 'dfs_pool' in cache_data and 'df_daily' in cache_data and not cache_data['df_daily'].empty:
            print("[IBKR] Loading deep multi-timeframe history from local disk cache (<0.01s)...")
            cached_dfs = cache_data['dfs_pool']
            cached_df_daily = cache_data['df_daily']
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
            compute_spotvol_baselines(df_daily_init, active_sess_date, today_et)
            need_background_hydration = True

        if need_background_hydration:
            asyncio.create_task(hydrate_deep_history_background(active_sess_date, today_et))

        # 3. Process Intraday 1D Bars (1-min)
        df_v1 = safe_to_series(b1_vix, 'vix')
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

        df_s1 = safe_to_series(b1_spx, 'spx')
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

    except Exception as ex:
        print(f"[IBKR Error] Historical data refresh failed: {ex}")


def compute_live_payload() -> Dict[str, Any]:
    """
    Compute full real-time snapshot of market prices, Overvix residuals,
    intraday term structure ratio stats, rolling correlation, and master confluence signal
    for both SPX & VIX and NDX & VXN, plus Tech Vol Spread.
    """
    spx_curr, spx_src = get_current_price(state.spx_ticker, state.latest_spx_close)
    vix_curr, vix_src = get_current_price(state.vix_ticker, state.latest_vix_close)
    vix3m_curr, vix3m_src = get_current_price(state.vix3m_ticker, state.latest_vix3m_close)
    ndx_curr, ndx_src = get_current_price(state.ndx_ticker, state.latest_ndx_close)
    vxn_curr, vxn_src = get_current_price(state.vxn_ticker, state.latest_vxn_close)

    now_et = datetime.now(pytz.timezone('US/Eastern'))
    today_et = now_et.strftime('%Y-%m-%d')
    is_weekday = (now_et.weekday() < 5)
    is_rth_time = is_weekday and (dtime(9, 30) <= now_et.time() < dtime(16, 0))

    # A live RTH trading session is active only during RTH hours AND when today's session has actually begun
    is_live_rth = is_rth_time and (
        ("LIVE" in spx_src or "LIVE" in ndx_src) or 
        (state.active_session_date == today_et)
    )

    live_vix_val, live_vix_src = vix_curr, vix_src

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
        # Intraday charts display the displayed session (state.active_session_date).
        # Pin current_point and session levels to the official closing values of the displayed session
        # so the beacon sits precisely at the tip of the trail.

        # Prior completed session close reference baselines (from baseline regression)
        spx_base = state.latest_spx_close if state.latest_spx_close > 0 else (float(state.df_spx_vix_1d['spx'].iloc[0]) if not state.df_spx_vix_1d.empty else spx_curr)
        vix_base = state.latest_vix_close if state.latest_vix_close > 0 else (float(state.df_spx_vix_1d['vix'].iloc[0]) if not state.df_spx_vix_1d.empty else vix_curr)
        vix3m_base = state.latest_vix3m_close if state.latest_vix3m_close > 0 else (float(state.df_ts_1d['vix3m'].iloc[0]) if not state.df_ts_1d.empty else vix3m_curr)
        ndx_base = state.latest_ndx_close if state.latest_ndx_close > 0 else (float(state.df_ndx_vxn_1d['ndx'].iloc[0]) if not state.df_ndx_vxn_1d.empty else ndx_curr)
        vxn_base = state.latest_vxn_close if state.latest_vxn_close > 0 else (float(state.df_ndx_vxn_1d['vxn'].iloc[0]) if not state.df_ndx_vxn_1d.empty else vxn_curr)

        # SPX & VIX closing coordinates and prices for displayed session
        if not state.df_spx_vix_1d.empty:
            curr_x = float(state.df_spx_vix_1d['spx_pct'].iloc[-1])
            curr_y = float(state.df_spx_vix_1d['vix_pt'].iloc[-1])
            spx_curr = float(state.df_spx_vix_1d['spx'].iloc[-1])
            vix_curr = float(state.df_spx_vix_1d['vix'].iloc[-1])
        else:
            curr_x = ((spx_curr - spx_base) / spx_base * 100.0) if spx_base > 0 else state.last_sess_x
            curr_y = (vix_curr - vix_base) if vix_base > 0 else state.last_sess_y

        # VIX3M closing price for displayed session
        if not state.df_ts_1d.empty:
            vix3m_curr = float(state.df_ts_1d['vix3m'].iloc[-1])
            vix3m_pt = vix3m_curr - vix3m_base if vix3m_base > 0 else 0.0
        else:
            vix3m_pt = vix3m_curr - vix3m_base if vix3m_base > 0 else 0.0

        # NDX & VXN closing coordinates and prices for displayed session
        if not state.df_ndx_vxn_1d.empty:
            curr_ndx_x = float(state.df_ndx_vxn_1d['ndx_pct'].iloc[-1])
            curr_ndx_y = float(state.df_ndx_vxn_1d['vxn_pt'].iloc[-1])
            ndx_curr = float(state.df_ndx_vxn_1d['ndx'].iloc[-1])
            vxn_curr = float(state.df_ndx_vxn_1d['vxn'].iloc[-1])
        else:
            curr_ndx_x = ((ndx_curr - ndx_base) / ndx_base * 100.0) if ndx_base > 0 else state.last_sess_ndx_x
            curr_ndx_y = (vxn_curr - vxn_base) if vxn_base > 0 else state.last_sess_ndx_y

        if is_weekday and now_et.time() < dtime(9, 30):
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

    src_suffix = "" if is_live_rth else (" (PRE-MARKET)" if session_status == "PRE_MARKET" else " (CLOSED)")

    return {
        "timestamp": curr_time_str,
        "datetime": curr_dt_str,
        "session_date": state.active_session_date,
        "hist_version": state.hist_version,
        "mode": mode_tag,
        "is_rth_active": is_live_rth,
        "session_status": session_status,
        "premarket": {
            "is_premarket": (session_status == "PRE_MARKET"),
            "gth_vix": round(live_vix_val, 2) if "LIVE" in live_vix_src else round(state.latest_vix_close, 2),
            "gth_vix_change": round(live_vix_val - state.latest_vix_close, 2) if "LIVE" in live_vix_src else 0.0,
            "vix_source": live_vix_src,
            "session_date": state.active_session_date,
            "opens_at": "09:30 ET"
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

            # Check for RTH open transition (09:30 ET), periodic intraday refresh every 60s, or market close final sync
            if state.is_connected and state.ib and state.ib.isConnected():
                should_refresh = False
                # If market just opened at 09:30 ET and active session is still the prior day
                if is_weekday and (now_et.time() >= dtime(9, 30)) and (state.active_session_date != today_et):
                    should_refresh = True
                # Periodic refresh every 60s during RTH to pull latest 1-min bars
                elif is_weekday and (dtime(9, 30) <= now_et.time() < dtime(16, 0)) and (now - last_hist_refresh >= 60.0):
                    should_refresh = True
                # Post-close final sync: if RTH ended (>= 16:00 ET) and we haven't synced since 16:00 ET today
                elif is_weekday and (now_et.time() >= dtime(16, 0)) and (last_hist_refresh < datetime.combine(now_et.date(), dtime(16, 0)).replace(tzinfo=pytz.timezone('US/Eastern')).timestamp()):
                    should_refresh = True

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
        return res

    # Format SPX & VIX Correlation across 8 horizons
    corr_1d = format_corr_df(state.df_spx_vix_1d, 'spx_pct', 'vix_pt')
    corr_5d = format_corr_df(state.df_spx_vix_5d, 'spx_pct', 'vix_pt')
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
            "5D": corr_5d,
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
