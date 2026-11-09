import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
import pickle
from datetime import datetime
import pytz
from ib_async import IB, Index, util
from dashboard import (
    state, bars_to_df, safe_to_series, resample_30m_to_session,
    DEFAULT_IBKR_HOST, DEFAULT_IBKR_PORT, DEFAULT_CLIENT_ID
)
import pandas as pd
import numpy as np
from scipy import stats

CACHE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'history_cache.pkl')

def compute_spotvol_baselines(df_daily: pd.DataFrame, active_sess_date: str, today_et: str):
    df_sv = df_daily[['spx', 'vix']].dropna()
    if active_sess_date:
        df_prior_sv = df_sv.loc[[str(d)[:10] < active_sess_date for d in df_sv.index]]
        if df_prior_sv.empty:
            df_prior_sv = df_sv.iloc[:-1] if len(df_sv) > 1 else df_sv
    else:
        is_today_in_sv = (str(df_sv.index[-1])[:10] == today_et) if not df_sv.empty else False
        df_prior_sv = df_sv.iloc[:-1] if is_today_in_sv and len(df_sv) > 1 else df_sv

    df_prior_sv = df_prior_sv.copy()
    df_prior_sv['spx_pct'] = df_prior_sv['spx'].pct_change() * 100.0
    df_prior_sv['vix_pt'] = df_prior_sv['vix'].diff()
    df_prior_sv = df_prior_sv.dropna()

    state.df_spotvol = df_prior_sv.iloc[-state.window_days:].copy()
    state.df_spotvol = state.df_spotvol.rename(columns={'spx': 'spx_close', 'vix': 'vix_close'})

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

    # NDX Spot-Vol
    df_sv_ndx = df_daily[['ndx', 'vxn']].dropna()
    if active_sess_date:
        df_prior_ndx = df_sv_ndx.loc[[str(d)[:10] < active_sess_date for d in df_sv_ndx.index]]
        if df_prior_ndx.empty:
            df_prior_ndx = df_sv_ndx.iloc[:-1] if len(df_sv_ndx) > 1 else df_sv_ndx
    else:
        is_today_in_ndx = (str(df_sv_ndx.index[-1])[:10] == today_et) if not df_sv_ndx.empty else False
        df_prior_ndx = df_sv_ndx.iloc[:-1] if is_today_in_ndx and len(df_sv_ndx) > 1 else df_sv_ndx

    df_prior_ndx = df_prior_ndx.copy()
    df_prior_ndx['ndx_pct'] = df_prior_ndx['ndx'].pct_change() * 100.0
    df_prior_ndx['vxn_pt'] = df_prior_ndx['vxn'].diff()
    df_prior_ndx = df_prior_ndx.dropna()

    state.df_spotvol_ndx = df_prior_ndx.iloc[-state.window_days:].copy()
    state.df_spotvol_ndx = state.df_spotvol_ndx.rename(columns={'ndx': 'ndx_close', 'vxn': 'vxn_close'})

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

print("Test syntax check: OK")
