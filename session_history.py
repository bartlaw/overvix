"""
session_history.py
Historical Intraday Session Replay Engine & Cache for Overvix Terminal.

Provides:
- Persistent disk caching of 1-minute intraday sessions in `data/sessions/`
- Prior-day baseline calculation (60-day Spot-Vol OLS prior to the selected date)
- 1-minute historical bar retrieval for SPX, VIX, and VIX3M
- Synchronization and alignment of Spot-Vol, Term Structure, and Dynamic Correlation
- Protection against IBKR pacing violations via file caching and in-flight request locking
"""

import os
import json
import asyncio
from datetime import datetime, date
from typing import Optional, Dict, Any, List
import pandas as pd
import numpy as np
from scipy import stats
from ib_async import IB, Contract, util

CACHE_DIR = os.path.join(os.path.dirname(__file__), 'data', 'sessions')
os.makedirs(CACHE_DIR, exist_ok=True)

NOTABLE_DATES_FILE = os.path.join(os.path.dirname(__file__), 'data', 'notable_dates.json')

# Lock to ensure only one historical intraday query executes at a time with IBKR
session_fetch_lock = asyncio.Lock()


def load_notable_dates() -> List[Dict[str, str]]:
    """Load notable dates from data/notable_dates.json."""
    if os.path.exists(NOTABLE_DATES_FILE):
        try:
            with open(NOTABLE_DATES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
        except Exception as e:
            print(f"[Notable Dates Error] Failed reading {NOTABLE_DATES_FILE}: {e}")
    # Default fallback
    return [
        {"date": "2026-10-22", "label": "2026-10-22 (Panic Capitulation & Vol Peak)"},
        {"date": "2026-10-23", "label": "2026-10-23 (Sweep & Vol Exhaustion Low)"},
        {"date": "2026-10-26", "label": "2026-10-26 (Mean-Reversion Rip)"}
    ]


def save_notable_date(date_str: str, label: str) -> List[Dict[str, str]]:
    """Add or update a notable date in data/notable_dates.json."""
    dates = load_notable_dates()
    # If date already exists, update label; otherwise insert
    updated = False
    for item in dates:
        if item.get("date") == date_str:
            item["label"] = label
            updated = True
            break
    if not updated:
        dates.append({"date": date_str, "label": label})
        # Keep sorted by date
        dates.sort(key=lambda x: x.get("date", ""))

    try:
        os.makedirs(os.path.dirname(NOTABLE_DATES_FILE), exist_ok=True)
        with open(NOTABLE_DATES_FILE, 'w', encoding='utf-8') as f:
            json.dump(dates, f, indent=2)
        print(f"[Notable Dates] Saved {date_str} ('{label}') to {NOTABLE_DATES_FILE}")
    except Exception as e:
        print(f"[Notable Dates Error] Failed saving notable dates: {e}")
    return dates


def get_cached_dates() -> List[str]:
    """Return sorted list of dates (YYYY-MM-DD) currently saved in local disk cache."""
    if not os.path.exists(CACHE_DIR):
        return []
    dates = []
    for fname in os.listdir(CACHE_DIR):
        if fname.endswith('.json'):
            d = fname[:-5]
            if len(d) == 10 and d[4] == '-' and d[7] == '-':
                dates.append(d)
    return sorted(dates)


def load_cached_session(date_str: str) -> Optional[Dict[str, Any]]:
    """Load session JSON from disk cache if present and valid."""
    filepath = os.path.join(CACHE_DIR, f"{date_str}.json")
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Auto-upgrade ndx current_point if missing & ensure 2.5 pt threshold default
            if data and isinstance(data.get("ndx"), dict):
                if "current_point" not in data["ndx"]:
                    m = data["ndx"].get("market", {})
                    px = m.get("pct_change")
                    py = m.get("vxn", {}).get("pt_change")
                    if px is None or py is None:
                        trail = data["ndx"].get("overvix", {}).get("intraday_trail", {})
                        if trail.get("x") and trail.get("y"):
                            px = trail["x"][-1]
                            py = trail["y"][-1]
                        else:
                            px = 0.0
                            py = 0.0
                    data["ndx"]["current_point"] = {"x": round(float(px), 2), "y": round(float(py), 2)}

                ndx_mod = data["ndx"].get("model")
                if isinstance(ndx_mod, dict) and ndx_mod.get("threshold_pts") in (None, 2.0):
                    ndx_mod["threshold_pts"] = 2.5
                    ov = data["ndx"].get("overvix", {})
                    res_pts = ov.get("residual_pts", 0.0)
                    ov["is_overvixed"] = bool(res_pts >= 2.5)
                    ov["status"] = "OVER-VXN" if ov["is_overvixed"] else "NORMAL"

                try:
                    with open(filepath, 'w', encoding='utf-8') as f_out:
                        json.dump(data, f_out, indent=2)
                except Exception:
                    pass
            return data
        except Exception as e:
            print(f"[Cache Error] Failed reading cache for {date_str}: {e}")
    return None


def save_cached_session(date_str: str, payload: Dict[str, Any]):
    """Persist session JSON to disk cache."""
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        filepath = os.path.join(CACHE_DIR, f"{date_str}.json")
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)
        print(f"[Cache Saved] Successfully cached session {date_str} to disk ({os.path.getsize(filepath)} bytes)")
    except Exception as e:
        print(f"[Cache Error] Failed saving cache for {date_str}: {e}")


def to_eastern_dt_list(idx) -> List[str]:
    """Convert pandas DatetimeIndex cleanly to US/Eastern formatted strings (YYYY-MM-DD HH:MM)."""
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


async def fetch_and_build_historical_session(
    ib: IB,
    spx_contract: Contract,
    vix_contract: Contract,
    vix3m_contract: Contract,
    df_daily: pd.DataFrame,
    target_date: str,
    threshold_pts: float = 2.0,
    window_days: int = 60,
    ndx_contract: Optional[Contract] = None,
    vxn_contract: Optional[Contract] = None,
    ndx_threshold_pts: float = 2.5
) -> Dict[str, Any]:
    """
    Fetch and assemble full historical session payload for target_date (YYYY-MM-DD):
    1. Returns disk cache if already stored with complete multi-asset coverage.
    2. Uses df_daily to slice the 60-day baseline strictly preceding target_date (SPX & NDX).
    3. Requests 1-day 1-minute historical bars for SPX, VIX, VIX3M, and optionally NDX, VXN from IBKR.
    4. Computes Spot-Vol trails, Term Structure 1D, Tech Vol Spread, and Dynamic Correlation 1D.
    5. Saves to disk cache and returns.
    """
    # 1. Check cache first (must have 'ndx' if ndx_contract is requested)
    cached = load_cached_session(target_date)
    if cached is not None:
        if ndx_contract is None or ("ndx" in cached and "tech_vol" in cached):
            print(f"[Session History] Returning cached data for {target_date} (0ms)")
            return cached

    async with session_fetch_lock:
        # Re-check cache in case another coroutine just finished fetching it
        cached = load_cached_session(target_date)
        if cached is not None:
            if ndx_contract is None or ("ndx" in cached and "tech_vol" in cached):
                return cached

        print(f"[Session History] Building session data for {target_date} from IBKR (SPX, VIX, VIX3M, NDX, VXN)...")

        if not ib or not ib.isConnected():
            raise RuntimeError("IBKR is not connected. Cannot fetch historical session.")

        if df_daily.empty:
            raise RuntimeError("Daily historical dataset is empty. Cannot compute prior baseline.")

        # Ensure df_daily index is formatted as YYYY-MM-DD strings
        df_d = df_daily.copy()
        df_d.index = [str(d)[:10] for d in df_d.index]

        # Prior trading days
        prior_daily = df_d.loc[df_d.index < target_date]
        if prior_daily.empty:
            raise ValueError(f"No prior trading days found before {target_date} in 1-year history.")

        # Prior close reference values (SPX / VIX / VIX3M)
        prior_spx = float(prior_daily['spx'].iloc[-1])
        prior_vix = float(prior_daily['vix'].iloc[-1])
        prior_vix3m = float(prior_daily['vix3m'].iloc[-1]) if 'vix3m' in prior_daily.columns else prior_vix
        prior_ratio = prior_vix / prior_vix3m if prior_vix3m > 0 else 1.0

        # Prior close reference values (NDX / VXN)
        has_ndx_history = ('ndx' in prior_daily.columns and 'vxn' in prior_daily.columns)
        prior_ndx = float(prior_daily['ndx'].iloc[-1]) if has_ndx_history else 0.0
        prior_vxn = float(prior_daily['vxn'].iloc[-1]) if has_ndx_history else 0.0
        prior_tech_spread = prior_vxn - prior_vix if has_ndx_history else 0.0
        prior_tech_ratio = prior_vxn / prior_vix if (has_ndx_history and prior_vix > 0) else 1.0

        # 60-day baseline prior to target_date (SPX / VIX)
        baseline_slice = prior_daily.iloc[-window_days:].copy()
        baseline_slice['spx_pct'] = baseline_slice['spx'].pct_change() * 100.0
        baseline_slice['vix_pt'] = baseline_slice['vix'].diff()
        baseline_clean = baseline_slice.dropna(subset=['spx_pct', 'vix_pt'])

        x_hist = [round(float(v), 2) for v in baseline_clean['spx_pct'].tolist()]
        y_hist = [round(float(v), 2) for v in baseline_clean['vix_pt'].tolist()]
        dates_sv = [str(d)[:10] for d in baseline_clean.index]

        # OLS Regression for SPX / VIX baseline
        x_arr = np.array(x_hist)
        y_arr = np.array(y_hist)
        slope, intercept, r_value, _, _ = stats.linregress(x_arr, y_arr)
        r_squared = float(r_value ** 2)
        slope = float(slope)
        intercept = float(intercept)
        vol_slope = float(1.0 / slope) if slope != 0 else 0.0

        # 60-day baseline prior to target_date (NDX / VXN)
        if has_ndx_history:
            baseline_slice['ndx_pct'] = baseline_slice['ndx'].pct_change() * 100.0
            baseline_slice['vxn_pt'] = baseline_slice['vxn'].diff()
            baseline_ndx_clean = baseline_slice.dropna(subset=['ndx_pct', 'vxn_pt'])
            x_ndx_hist = [round(float(v), 2) for v in baseline_ndx_clean['ndx_pct'].tolist()]
            y_ndx_hist = [round(float(v), 2) for v in baseline_ndx_clean['vxn_pt'].tolist()]
            dates_ndx_sv = [str(d)[:10] for d in baseline_ndx_clean.index]

            x_ndx_arr = np.array(x_ndx_hist)
            y_ndx_arr = np.array(y_ndx_hist)
            ndx_slope, ndx_intercept, ndx_r_val, _, _ = stats.linregress(x_ndx_arr, y_ndx_arr)
            ndx_r_squared = float(ndx_r_val ** 2)
            ndx_slope = float(ndx_slope)
            ndx_intercept = float(ndx_intercept)
            ndx_vol_slope = float(1.0 / ndx_slope) if ndx_slope != 0 else 0.0
        else:
            x_ndx_hist, y_ndx_hist, dates_ndx_sv = [], [], []
            ndx_slope, ndx_intercept, ndx_r_squared, ndx_vol_slope = 0.0, 0.0, 0.0, 0.0

        # Format IBKR endDateTime (End of day UTC/ET notation)
        date_clean = target_date.replace('-', '')
        end_dt_str = f"{date_clean} 23:00:00"

        # Request 1-min bars for SPX, VIX, and VIX3M
        print(f"[IBKR Request] Fetching 1-min intraday bars for {target_date} (SPX, VIX, VIX3M)...")
        b1_spx = await ib.reqHistoricalDataAsync(
            spx_contract, endDateTime=end_dt_str, durationStr='1 D',
            barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        b1_vix = await ib.reqHistoricalDataAsync(
            vix_contract, endDateTime=end_dt_str, durationStr='1 D',
            barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
        )
        b1_vix3m = await ib.reqHistoricalDataAsync(
            vix3m_contract, endDateTime=end_dt_str, durationStr='1 D',
            barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
        )

        # Request 1-min bars for NDX & VXN if requested
        b1_ndx, b1_vxn = None, None
        if ndx_contract and vxn_contract:
            print(f"[IBKR Request] Fetching 1-min intraday bars for {target_date} (NDX, VXN)...")
            b1_ndx = await ib.reqHistoricalDataAsync(
                ndx_contract, endDateTime=end_dt_str, durationStr='1 D',
                barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
            )
            b1_vxn = await ib.reqHistoricalDataAsync(
                vxn_contract, endDateTime=end_dt_str, durationStr='1 D',
                barSizeSetting='1 min', whatToShow='TRADES', useRTH=True, formatDate=1
            )

        df_s1 = util.df(b1_spx).set_index('date')['close'].rename('spx') if b1_spx else pd.Series(dtype=float)
        df_v1 = util.df(b1_vix).set_index('date')['close'].rename('vix') if b1_vix else pd.Series(dtype=float)
        df_v3 = util.df(b1_vix3m).set_index('date')['close'].rename('vix3m') if b1_vix3m else pd.Series(dtype=float)
        df_n1 = util.df(b1_ndx).set_index('date')['close'].rename('ndx') if b1_ndx else pd.Series(dtype=float)
        df_vx1 = util.df(b1_vxn).set_index('date')['close'].rename('vxn') if b1_vxn else pd.Series(dtype=float)

        if df_s1.empty or df_v1.empty:
            raise ValueError(f"No intraday bars returned for {target_date}. The market may have been closed.")

        # Merge Intraday Datasets
        merge_cols = [df_s1, df_v1, df_v3]
        if not df_n1.empty and not df_vx1.empty:
            merge_cols.extend([df_n1, df_vx1])
        df_sess = pd.concat(merge_cols, axis=1).dropna()
        if df_sess.empty:
            raise ValueError(f"Failed aligning intraday bars for {target_date}.")

        # Intraday Calculations (SPX / VIX)
        times_formatted = to_eastern_dt_list(df_sess.index)
        df_sess['spx_pct'] = (df_sess['spx'] - prior_spx) / prior_spx * 100.0
        df_sess['vix_pt'] = df_sess['vix'] - prior_vix
        df_sess['ratio'] = df_sess['vix'] / df_sess['vix3m']
        
        # Rolling 30-minute Pearson correlation (SPX / VIX)
        df_sess['spx_ret'] = df_sess['spx'].pct_change()
        df_sess['vix_diff'] = df_sess['vix'].diff()
        df_sess['rolling_corr'] = df_sess['spx_ret'].rolling(30, min_periods=10).corr(df_sess['vix_diff']).fillna(-0.70)

        # Closing values of SPX session
        final_spx = float(df_sess['spx'].iloc[-1])
        final_vix = float(df_sess['vix'].iloc[-1])
        final_vix3m = float(df_sess['vix3m'].iloc[-1])
        final_x = float(df_sess['spx_pct'].iloc[-1])
        final_y = float(df_sess['vix_pt'].iloc[-1])
        final_ratio = float(df_sess['ratio'].iloc[-1])
        final_corr = float(df_sess['rolling_corr'].iloc[-1])

        # Overvix residual (SPX)
        expected_vix_pt = intercept + slope * final_x
        residual_pts = final_y - expected_vix_pt
        is_overvixed = bool(residual_pts >= threshold_pts)

        # Term structure stats
        open_ratio = float(df_sess['ratio'].iloc[0])
        high_ratio = float(df_sess['ratio'].max())
        low_ratio = float(df_sess['ratio'].min())
        ratio_change_pts = final_ratio - prior_ratio
        ratio_change_pct = (ratio_change_pts / prior_ratio) * 100.0 if prior_ratio > 0 else 0.0
        is_inverted = bool(final_ratio >= 1.00)
        is_flattening = bool(0.90 <= final_ratio < 1.00)
        ts_regime = "BACKWARDATION" if is_inverted else ("FLATTENING" if is_flattening else "CONTANGO")

        # Correlation Badge & Status
        if final_corr >= 0.0:
            corr_status = "DECOUPLED (POSITIVE)"
            corr_badge = "DECOUPLED"
            corr_desc = "Spot and Volatility moved in the same direction."
        elif final_corr >= -0.40:
            corr_status = "WEAK INVERSE"
            corr_badge = "WEAK INVERSE"
            corr_desc = "Correlation weakened below normal inverse threshold."
        else:
            corr_status = "NORMAL INVERSE"
            corr_badge = "NORMAL INVERSE"
            corr_desc = "Classic healthy inverse spot-vol correlation."

        # Master Confluence Signal (SPX)
        is_dual_alert = is_overvixed and is_inverted
        is_overvix_alert = is_overvixed and not is_inverted
        is_inversion_alert = is_inverted and not is_overvixed
        is_normal = not is_overvixed and not is_inverted

        if is_dual_alert:
            confluence_tag = "HIGH CONVICTION PANIC"
            confluence_desc = "Simultaneous Overvix Panic and Term Structure Inversion."
        elif is_overvix_alert:
            confluence_tag = "OVERVIX PANIC"
            confluence_desc = "Overvix triggered while Term Structure remained in contango."
        elif is_inversion_alert:
            confluence_tag = "TERM STRUCTURE INVERSION"
            confluence_desc = "VIX > VIX3M inversion without exceeding Spot-Vol threshold."
        else:
            confluence_tag = "EQUILIBRIUM"
            confluence_desc = "Normal Spot-Vol regression pricing and contango term structure."

        # NDX / VXN calculations if available
        has_ndx_intraday = ('ndx' in df_sess.columns and 'vxn' in df_sess.columns and prior_ndx > 0)
        if has_ndx_intraday:
            df_sess['ndx_pct'] = (df_sess['ndx'] - prior_ndx) / prior_ndx * 100.0
            df_sess['vxn_pt'] = df_sess['vxn'] - prior_vxn
            df_sess['tech_spread'] = df_sess['vxn'] - df_sess['vix']
            df_sess['tech_ratio'] = df_sess['vxn'] / df_sess['vix']
            df_sess['ndx_ret'] = df_sess['ndx'].pct_change()
            df_sess['vxn_diff'] = df_sess['vxn'].diff()
            df_sess['ndx_rolling_corr'] = df_sess['ndx_ret'].rolling(30, min_periods=10).corr(df_sess['vxn_diff']).fillna(-0.70)

            final_ndx = float(df_sess['ndx'].iloc[-1])
            final_vxn = float(df_sess['vxn'].iloc[-1])
            final_ndx_x = float(df_sess['ndx_pct'].iloc[-1])
            final_ndx_y = float(df_sess['vxn_pt'].iloc[-1])
            final_ndx_corr = float(df_sess['ndx_rolling_corr'].iloc[-1])
            final_tech_spread = float(df_sess['tech_spread'].iloc[-1])
            final_tech_ratio = float(df_sess['tech_ratio'].iloc[-1])

            expected_vxn_pt = ndx_intercept + ndx_slope * final_ndx_x
            residual_ndx_pts = final_ndx_y - expected_vxn_pt
            is_overvxned = bool(residual_ndx_pts >= ndx_threshold_pts)

            ndx_package = {
                "market": {
                    "current": round(final_ndx, 2),
                    "pct_change": round(final_ndx_x, 2),
                    "source": "HISTORICAL CLOSE",
                    "vxn": {
                        "current": round(final_vxn, 2),
                        "pt_change": round(final_ndx_y, 2),
                        "source": "HISTORICAL CLOSE"
                    }
                },
                "model": {
                    "r_squared": round(ndx_r_squared, 4),
                    "slope": round(ndx_slope, 4),
                    "vol_slope": round(ndx_vol_slope, 4),
                    "intercept": round(ndx_intercept, 4),
                    "window_days": window_days,
                    "threshold_pts": round(ndx_threshold_pts, 2)
                },
                "overvix": {
                    "expected_vol_pt": round(expected_vxn_pt, 2),
                    "residual_pts": round(residual_ndx_pts, 2),
                    "is_overvixed": is_overvxned,
                    "status": "OVER-VXN" if is_overvxned else "NORMAL",
                    "x_history": x_ndx_hist,
                    "y_history": y_ndx_hist,
                    "dates": dates_ndx_sv,
                    "intraday_trail": {
                        "x": [round(float(v), 2) for v in df_sess['ndx_pct'].tolist()],
                        "y": [round(float(v), 2) for v in df_sess['vxn_pt'].tolist()],
                        "times": times_formatted
                    }
                },
                "correlation": {
                    "rolling_corr": round(final_ndx_corr, 3),
                    "status": "NORMAL INVERSE" if final_ndx_corr < -0.40 else ("WEAK" if final_ndx_corr < 0 else "DECOUPLED"),
                    "badge": "HEALTHY" if final_ndx_corr < -0.40 else ("CAUTION" if final_ndx_corr < 0 else "DECOUPLED")
                },
                "intraday_correlation": {
                    "times": times_formatted,
                    "spx_pct": [round(float(v), 2) for v in df_sess['ndx_pct'].tolist()],
                    "vix_pt": [round(float(v), 2) for v in df_sess['vxn_pt'].tolist()],
                    "ndx_pct": [round(float(v), 2) for v in df_sess['ndx_pct'].tolist()],
                    "vxn_pt": [round(float(v), 2) for v in df_sess['vxn_pt'].tolist()],
                    "spot_raw": [round(float(v), 2) for v in df_sess['ndx'].tolist()],
                    "vol_raw": [round(float(v), 2) for v in df_sess['vxn'].tolist()],
                    "ndx_raw": [round(float(v), 2) for v in df_sess['ndx'].tolist()],
                    "vxn_raw": [round(float(v), 2) for v in df_sess['vxn'].tolist()],
                    "rolling_corr": [round(float(v), 3) for v in df_sess['ndx_rolling_corr'].tolist()],
                    "current_corr": round(final_ndx_corr, 3),
                    "1D": {
                        "times": times_formatted,
                        "spx_pct": [round(float(v), 2) for v in df_sess['ndx_pct'].tolist()],
                        "vix_pt": [round(float(v), 2) for v in df_sess['vxn_pt'].tolist()],
                        "ndx_pct": [round(float(v), 2) for v in df_sess['ndx_pct'].tolist()],
                        "vxn_pt": [round(float(v), 2) for v in df_sess['vxn_pt'].tolist()],
                        "spot_raw": [round(float(v), 2) for v in df_sess['ndx'].tolist()],
                        "vol_raw": [round(float(v), 2) for v in df_sess['vxn'].tolist()],
                        "ndx_raw": [round(float(v), 2) for v in df_sess['ndx'].tolist()],
                        "vxn_raw": [round(float(v), 2) for v in df_sess['vxn'].tolist()],
                        "rolling_corr": [round(float(v), 3) for v in df_sess['ndx_rolling_corr'].tolist()]
                    }
                },
                "current_point": {
                    "x": round(final_ndx_x, 2),
                    "y": round(final_ndx_y, 2)
                }
            }

            tech_vol_package = {
                "spread": round(final_tech_spread, 2),
                "ratio": round(final_tech_ratio, 4),
                "prior_spread": round(prior_tech_spread, 2),
                "prior_ratio": round(prior_tech_ratio, 4),
                "intraday": {
                    "low": round(float(df_sess['tech_spread'].min()), 2),
                    "high": round(float(df_sess['tech_spread'].max()), 2),
                    "open": round(float(df_sess['tech_spread'].iloc[0]), 2),
                    "ratio_low": round(float(df_sess['tech_ratio'].min()), 4),
                    "ratio_high": round(float(df_sess['tech_ratio'].max()), 4)
                },
                "intraday_1d": {
                    "times": times_formatted,
                    "spread": [round(float(v), 2) for v in df_sess['tech_spread'].tolist()],
                    "ratio": [round(float(v), 4) for v in df_sess['tech_ratio'].tolist()],
                    "vxn": [round(float(v), 2) for v in df_sess['vxn'].tolist()],
                    "vix": [round(float(v), 2) for v in df_sess['vix'].tolist()]
                }
            }
        else:
            ndx_package = None
            tech_vol_package = None

        payload: Dict[str, Any] = {
            "is_historical": True,
            "session_date": target_date,
            "session_bars": len(df_sess),
            "market": {
                "spx": {
                    "current": round(final_spx, 2),
                    "pct_change": round(final_x, 2),
                    "source": "HISTORICAL CLOSE"
                },
                "vix": {
                    "current": round(final_vix, 2),
                    "pt_change": round(final_y, 2),
                    "source": "HISTORICAL CLOSE"
                },
                "vix3m": {
                    "current": round(final_vix3m, 2),
                    "pt_change": round(final_vix3m - prior_vix3m, 2),
                    "source": "HISTORICAL CLOSE"
                }
            },
            "model": {
                "r_squared": round(r_squared, 4),
                "slope": round(slope, 4),
                "vol_slope": round(vol_slope, 4),
                "intercept": round(intercept, 4),
                "window_days": window_days,
                "threshold_pts": round(threshold_pts, 2)
            },
            "overvix": {
                "expected_vix_pt": round(expected_vix_pt, 2),
                "residual_pts": round(residual_pts, 2),
                "is_overvixed": is_overvixed,
                "status": "OVERVIXED" if is_overvixed else "NORMAL",
                "x_history": x_hist,
                "y_history": y_hist,
                "dates": dates_sv,
                "intraday_trail": {
                    "x": [round(float(v), 2) for v in df_sess['spx_pct'].tolist()],
                    "y": [round(float(v), 2) for v in df_sess['vix_pt'].tolist()],
                    "times": times_formatted
                }
            },
            "term_structure": {
                "ratio": round(final_ratio, 4),
                "is_inverted": is_inverted,
                "is_flattening": is_flattening,
                "regime": ts_regime,
                "intraday": {
                    "high": round(high_ratio, 4),
                    "low": round(low_ratio, 4),
                    "open": round(open_ratio, 4),
                    "change_pts": round(ratio_change_pts, 4),
                    "change_pct": round(ratio_change_pct, 2),
                    "latest_time": times_formatted[-1][-5:] if times_formatted else "16:00"
                },
                "intraday_1d": {
                    "times": times_formatted,
                    "vix": [round(float(v), 2) for v in df_sess['vix'].tolist()],
                    "vix3m": [round(float(v), 2) for v in df_sess['vix3m'].tolist()],
                    "ratio": [round(float(v), 4) for v in df_sess['ratio'].tolist()]
                }
            },
            "correlation": {
                "rolling_corr": round(final_corr, 3),
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
                "x": round(final_x, 2),
                "y": round(final_y, 2)
            },
            "intraday_correlation": {
                "times": times_formatted,
                "spx_pct": [round(float(v), 2) for v in df_sess['spx_pct'].tolist()],
                "vix_pt": [round(float(v), 2) for v in df_sess['vix_pt'].tolist()],
                "spot_raw": [round(float(v), 2) for v in df_sess['spx'].tolist()],
                "vol_raw": [round(float(v), 2) for v in df_sess['vix'].tolist()],
                "spx_raw": [round(float(v), 2) for v in df_sess['spx'].tolist()],
                "vix_raw": [round(float(v), 2) for v in df_sess['vix'].tolist()],
                "rolling_corr": [round(float(v), 3) for v in df_sess['rolling_corr'].tolist()],
                "current_corr": round(final_corr, 3),
                "1D": {
                    "times": times_formatted,
                    "spx_pct": [round(float(v), 2) for v in df_sess['spx_pct'].tolist()],
                    "vix_pt": [round(float(v), 2) for v in df_sess['vix_pt'].tolist()],
                    "spot_raw": [round(float(v), 2) for v in df_sess['spx'].tolist()],
                    "vol_raw": [round(float(v), 2) for v in df_sess['vix'].tolist()],
                    "spx_raw": [round(float(v), 2) for v in df_sess['spx'].tolist()],
                    "vix_raw": [round(float(v), 2) for v in df_sess['vix'].tolist()],
                    "rolling_corr": [round(float(v), 3) for v in df_sess['rolling_corr'].tolist()]
                },
                "metrics": {
                    "1D": round(final_corr, 3)
                }
            },
            "ndx": ndx_package,
            "tech_vol": tech_vol_package
        }

        # Save to disk cache
        save_cached_session(target_date, payload)
        return payload
