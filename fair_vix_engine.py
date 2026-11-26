"""
fair_vix_engine.py
Quantitative Fair VIX Estimation Engine combining:
  - Method 2: Realized Volatility (Yang-Zhang OHLC / Close-to-Close 5D, 10D, 21D) + Asymmetric EWMA HAR-RV
  - Method 4: 252-Day Exponentially Weighted (30D HL) Constrained Quadratic Drawdown Regression on Rolling 60D Drawdowns

Shared by both live streaming (dashboard.py) and historical replay (session_history.py).
"""

import math
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from scipy.optimize import lsq_linear


DEFAULT_VRP_PTS = 4.0
VRP_MIN_PTS = 2.5
VRP_MAX_PTS = 6.5
QUAD_FIT_WINDOW_DAYS = 252
QUAD_EWM_HALF_LIFE_DAYS = 30.0


def safe_to_ohlc_df(bars: Any, prefix: str) -> pd.DataFrame:
    """Parse IBKR daily bars into an OHLC DataFrame indexed by 'YYYY-MM-DD'."""
    cols = [f"{prefix}_open", f"{prefix}_high", f"{prefix}_low", f"{prefix}_close"]
    if not bars:
        return pd.DataFrame(columns=cols)
    try:
        records = []
        for b in bars:
            dt_str = str(getattr(b, "date", ""))[:10]
            if len(dt_str) != 10:
                continue
            o = float(getattr(b, "open", math.nan))
            h = float(getattr(b, "high", math.nan))
            l = float(getattr(b, "low", math.nan))
            c = float(getattr(b, "close", math.nan))
            if any(math.isnan(v) or v <= 0 for v in (o, h, l, c)):
                continue
            records.append({
                "date": dt_str,
                cols[0]: o,
                cols[1]: max(h, o, c),
                cols[2]: min(l, o, c),
                cols[3]: c,
            })
        if not records:
            return pd.DataFrame(columns=cols)
        return pd.DataFrame(records).drop_duplicates(subset=["date"]).set_index("date").sort_index()
    except Exception:
        return pd.DataFrame(columns=cols)


def calc_realized_vol_series(
    df_ohlc: Optional[pd.DataFrame],
    close_series: pd.Series,
    prefix: str,
    window: int,
) -> Tuple[pd.Series, str]:
    """
    Compute annualized realized volatility (%) over `window` trading days.
    Prefers Yang-Zhang (overnight + intraday range + drift) when daily OHLC is available,
    falling back seamlessly to Close-to-Close log-return volatility.
    """
    c = pd.to_numeric(close_series, errors="coerce").dropna()
    if c.empty:
        return pd.Series(dtype=float), "Close-to-Close"

    c2c_ret = np.log(c / c.shift(1))
    c2c_rv = c2c_ret.rolling(window, min_periods=max(3, min(window, 5))).std(ddof=1) * math.sqrt(252.0) * 100.0

    o_col, h_col, l_col, c_col = (
        f"{prefix}_open",
        f"{prefix}_high",
        f"{prefix}_low",
        f"{prefix}_close",
    )
    has_ohlc = (
        df_ohlc is not None
        and not df_ohlc.empty
        and all(col in df_ohlc.columns for col in (o_col, h_col, l_col, c_col))
    )
    if not has_ohlc or window < 2:
        return c2c_rv, "Close-to-Close"

    sub = df_ohlc[[o_col, h_col, l_col, c_col]].reindex(c.index).copy()
    # Replace close column with harmonized settlement close when available
    sub[c_col] = c
    valid_mask = (sub[o_col] > 0) & (sub[h_col] > 0) & (sub[l_col] > 0) & (sub[c_col] > 0) & (sub[h_col] >= sub[l_col])
    if int(valid_mask.sum()) < window + 2:
        return c2c_rv, "Close-to-Close"

    sub = sub.where(valid_mask)
    # Require genuine intraday range (not synthetic flat O=H=L=C)
    has_range = ((sub[h_col] - sub[l_col]) > 1e-6).rolling(window).sum() >= max(2, window // 2)

    prev_c = sub[c_col].shift(1)
    o_ret = np.log(sub[o_col] / prev_c)
    c_oc = np.log(sub[c_col] / sub[o_col])
    u = np.log(sub[h_col] / sub[o_col])
    d = np.log(sub[l_col] / sub[o_col])
    rs = (u * (u - c_oc) + d * (d - c_oc)).clip(lower=0.0)

    k = 0.34 / (1.34 + (window + 1.0) / (window - 1.0))
    sig_o2 = o_ret.rolling(window, min_periods=window).var(ddof=1)
    sig_c2 = c_oc.rolling(window, min_periods=window).var(ddof=1)
    sig_rs2 = rs.rolling(window, min_periods=window).mean()
    yz_var = (sig_o2 + k * sig_c2 + (1.0 - k) * sig_rs2).clip(lower=0.0)
    yz_rv = np.sqrt(yz_var) * math.sqrt(252.0) * 100.0

    combined = yz_rv.where(has_range & yz_rv.notna(), c2c_rv)
    used_yz = bool((has_range & yz_rv.notna()).iloc[-1]) if not combined.empty else False
    return combined, ("Yang-Zhang" if used_yz else "Close-to-Close")


def fit_quadratic_drawdown(
    spot_vals: np.ndarray,
    vol_vals: np.ndarray,
    dd_vals: Optional[np.ndarray] = None,
    half_life: Optional[float] = None,
    peak_window: int = 60,
) -> Dict[str, float]:
    """
    Fit constrained convex quadratic VIX(dd) = c0 + c1*dd + c2*dd^2
    where dd is drawdown (%) from rolling peak and c0 >= 5, c1 >= 0, c2 >= 0.
    Supports optional causal `dd_vals` (e.g., rolling 60D-peak drawdowns over 252D)
    and exponential time-decay weighting (`half_life` in trading days).
    """
    if len(spot_vals) < 5 or len(vol_vals) < 5:
        mean_v = float(np.mean(vol_vals)) if len(vol_vals) > 0 else 20.0
        peak_v = float(np.max(spot_vals[-peak_window:])) if len(spot_vals) > 0 else 1.0
        return {"peak": peak_v, "c0": mean_v, "c1": 0.0, "c2": 0.0, "r2": 0.0, "std_err": 1.5}

    peak = float(np.max(spot_vals[-peak_window:])) if peak_window > 0 else float(np.max(spot_vals))
    if peak <= 0:
        return {"peak": 1.0, "c0": float(np.mean(vol_vals)), "c1": 0.0, "c2": 0.0, "r2": 0.0, "std_err": 1.5}

    if dd_vals is not None and len(dd_vals) == len(vol_vals):
        dd = np.maximum(0.0, np.asarray(dd_vals, dtype=float))
    else:
        full_peak = float(np.max(spot_vals))
        dd = np.maximum(0.0, (full_peak - spot_vals) / full_peak * 100.0) if full_peak > 0 else np.zeros_like(spot_vals, dtype=float)

    n = len(vol_vals)
    use_ewm = half_life is not None and float(half_life) > 0.0
    if use_ewm:
        age = np.arange(n - 1, -1, -1, dtype=float)
        w = 0.5 ** (age / float(half_life))
        w_sum = max(float(np.sum(w)), 1e-9)
    else:
        w = np.ones(n, dtype=float)
        w_sum = float(n)

    if float(np.max(dd)) < 1e-4:
        w_mean = float(np.sum(w * vol_vals) / w_sum)
        w_std = float(np.sqrt(np.sum(w * (vol_vals - w_mean) ** 2) / w_sum)) if n > 1 else 1.0
        return {"peak": peak, "c0": w_mean, "c1": 0.0, "c2": 0.0, "r2": 0.0, "std_err": w_std}

    X = np.column_stack([np.ones_like(dd), dd, dd ** 2])
    try:
        if use_ewm:
            sw = np.sqrt(w)
            res = lsq_linear(X * sw[:, None], vol_vals * sw, bounds=([5.0, 0.0, 0.0], [50.0, 10.0, 5.0]))
        else:
            res = lsq_linear(X, vol_vals, bounds=([5.0, 0.0, 0.0], [np.inf, np.inf, np.inf]))
        c0, c1, c2 = float(res.x[0]), float(res.x[1]), float(res.x[2])
        pred = X @ res.x
    except Exception:
        c0 = float(np.sum(w * vol_vals) / w_sum)
        c1, c2 = 0.0, 0.0
        pred = np.full_like(vol_vals, c0, dtype=float)

    w_mean = float(np.sum(w * vol_vals) / w_sum)
    ss_res = float(np.sum(w * (vol_vals - pred) ** 2))
    ss_tot = float(np.sum(w * (vol_vals - w_mean) ** 2))
    r2 = max(0.0, min(1.0, 1.0 - ss_res / ss_tot)) if ss_tot > 1e-9 else 0.0
    if use_ewm:
        std_err = float(np.sqrt(ss_res / w_sum)) if n > 3 else 1.5
    else:
        std_err = float(np.std(vol_vals - pred, ddof=1)) if n > 3 else 1.5
    return {
        "peak": peak,
        "c0": c0,
        "c1": c1,
        "c2": c2,
        "r2": r2,
        "std_err": std_err,
    }


def _resolve_blend_weights(r2_quad: float, blend_mode: str) -> Tuple[float, float]:
    if blend_mode == "r2_weighted":
        w_m4 = max(0.30, min(0.70, float(r2_quad)))
        return round(1.0 - w_m4, 4), round(w_m4, 4)
    return 0.50, 0.50


def calc_ewma_har_features(close_series: pd.Series) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """
    Compute causal EWMA annualized volatility features (%) for Asymmetric HAR-RV:
      - ew5: short-term 5-day EWMA volatility
      - ew21: monthly 21-day EWMA volatility
      - ew_dn10: 10-day downside semi-volatility (only negative log returns, scaled symmetrically)
    """
    c = pd.to_numeric(close_series, errors="coerce").dropna()
    if c.empty:
        empty = pd.Series(dtype=float)
        return empty, empty, empty
    log_r = np.log(c / c.shift(1))
    ew5 = np.sqrt((log_r ** 2).ewm(span=5, adjust=False).mean() * 252.0) * 100.0
    ew21 = np.sqrt((log_r ** 2).ewm(span=21, adjust=False).mean() * 252.0) * 100.0
    neg_r = np.minimum(log_r, 0.0)
    ew_dn10 = np.sqrt((neg_r ** 2).ewm(span=10, adjust=False).mean() * 2.0 * 252.0) * 100.0
    return ew5, ew21, ew_dn10


def fit_har_rv(
    ew5_vals: np.ndarray,
    ew21_vals: np.ndarray,
    ew_dn10_vals: np.ndarray,
    vol_vals: np.ndarray,
    ridge: float = 25.0,
) -> Dict[str, Any]:
    """
    Fit ridge-regularized constrained Asymmetric EWMA HAR-RV regression:
      VIX_t = a + b1 * ew5 + b2 * ew21 + b3 * ew_dn10
    with intercept a in [5, 45] and slopes b_i in [0, 1].
    """
    ew5_a = np.asarray(ew5_vals, dtype=float)
    ew21_a = np.asarray(ew21_vals, dtype=float)
    dn10_a = np.asarray(ew_dn10_vals, dtype=float)
    y_a = np.asarray(vol_vals, dtype=float)

    mask = np.isfinite(ew5_a) & np.isfinite(ew21_a) & np.isfinite(dn10_a) & np.isfinite(y_a)
    if int(np.sum(mask)) < 30:
        return {
            "a": DEFAULT_VRP_PTS,
            "b_ew5": 0.25,
            "b_ew21": 0.75,
            "b_dn10": 0.0,
            "r2": 0.0,
            "is_fallback": True,
        }

    ew5_v = ew5_a[mask]
    ew21_v = ew21_a[mask]
    dn10_v = dn10_a[mask]
    y_v = y_a[mask]

    X = np.column_stack([np.ones(len(y_v)), ew5_v, ew21_v, dn10_v])
    reg = np.zeros((3, 4))
    reg_s = math.sqrt(max(0.0, float(ridge)))
    for j in range(3):
        reg[j, j + 1] = reg_s
    X_aug = np.vstack([X, reg])
    y_aug = np.concatenate([y_v, np.zeros(3)])

    try:
        res = lsq_linear(X_aug, y_aug, bounds=([5.0, 0.0, 0.0, 0.0], [45.0, 1.0, 1.0, 1.0]))
        a, b1, b2, b3 = float(res.x[0]), float(res.x[1]), float(res.x[2]), float(res.x[3])
        pred = X @ res.x
    except Exception:
        return {
            "a": DEFAULT_VRP_PTS,
            "b_ew5": 0.25,
            "b_ew21": 0.75,
            "b_dn10": 0.0,
            "r2": 0.0,
            "is_fallback": True,
        }

    ss_res = float(np.sum((y_v - pred) ** 2))
    ss_tot = float(np.sum((y_v - np.mean(y_v)) ** 2))
    r2 = max(0.0, min(1.0, 1.0 - ss_res / ss_tot)) if ss_tot > 1e-9 else 0.0
    return {
        "a": a,
        "b_ew5": b1,
        "b_ew21": b2,
        "b_dn10": b3,
        "r2": r2,
        "is_fallback": False,
    }


def compute_fair_vix_asset_model(
    df_daily: pd.DataFrame,
    df_ohlc: Optional[pd.DataFrame],
    spot_col: str,
    vol_col: str,
    window_days: int = 60,
    vrp_mode: str = "auto",
    vrp_fixed_pts: float = DEFAULT_VRP_PTS,
    blend_mode: str = "r2_weighted",
    as_of_date: Optional[str] = None,
    inclusive_as_of: bool = False,
) -> Dict[str, Any]:
    """
    Build Method 2 (RV + VRP) and Method 4 (Rolling Quadratic Drawdown) models for one asset pair
    along with precomputed point-in-time `daily_params` for historical horizons and scatter/curve arrays.
    """
    if df_daily is None or df_daily.empty:
        return {}

    c_s = spot_col if spot_col in df_daily.columns else (f"{spot_col}_close" if f"{spot_col}_close" in df_daily.columns else None)
    c_v = vol_col if vol_col in df_daily.columns else (f"{vol_col}_close" if f"{vol_col}_close" in df_daily.columns else None)
    if not c_s or not c_v:
        return {}

    df = df_daily[[c_s, c_v]].dropna().copy()
    df.columns = ["spot", "vol"]
    df.index = [str(d)[:10] for d in df.index]
    df = df[~df.index.duplicated(keep="last")].sort_index()

    if as_of_date:
        if inclusive_as_of:
            df_fit = df.loc[[d <= as_of_date for d in df.index]]
        else:
            df_fit = df.loc[[d < as_of_date for d in df.index]]
    else:
        df_fit = df

    if df_fit.empty:
        df_fit = df
    if len(df_fit) < 6:
        return {}

    # Compute rolling realized volatilities and causal EWMA HAR-RV features on full sorted daily series
    rv5_all, m5 = calc_realized_vol_series(df_ohlc, df["spot"], spot_col, 5)
    rv10_all, m10 = calc_realized_vol_series(df_ohlc, df["spot"], spot_col, 10)
    rv21_all, m21 = calc_realized_vol_series(df_ohlc, df["spot"], spot_col, 21)
    rv_method = m21 if (m21 == "Yang-Zhang" or m10 == "Yang-Zhang") else "Close-to-Close"
    ew5_all, ew21_all, ew_dn10_all = calc_ewma_har_features(df["spot"])

    exp_rv_all = (
        0.20 * rv5_all.bfill().fillna(16.0)
        + 0.30 * rv10_all.bfill().fillna(16.0)
        + 0.50 * rv21_all.bfill().fillna(16.0)
    )

    ew5_fit_arr = ew5_all.reindex(df_fit.index).values.astype(float)
    ew21_fit_arr = ew21_all.reindex(df_fit.index).values.astype(float)
    ew_dn10_fit_arr = ew_dn10_all.reindex(df_fit.index).values.astype(float)
    rv21_fit_arr = rv21_all.reindex(df_fit.index).values.astype(float)
    vols_fit_arr = df_fit["vol"].values.astype(float)

    # Current baseline stats (strictly on df_fit)
    last_fit_date = df_fit.index[-1]
    rv5_now = float(rv5_all.loc[last_fit_date]) if pd.notna(rv5_all.loc[last_fit_date]) else float(exp_rv_all.loc[last_fit_date])
    rv10_now = float(rv10_all.loc[last_fit_date]) if pd.notna(rv10_all.loc[last_fit_date]) else float(exp_rv_all.loc[last_fit_date])
    rv21_now = float(rv21_all.loc[last_fit_date]) if pd.notna(rv21_all.loc[last_fit_date]) else float(exp_rv_all.loc[last_fit_date])
    exp_rv_now = float(exp_rv_all.loc[last_fit_date])
    ew5_now = float(ew5_fit_arr[-1]) if np.isfinite(ew5_fit_arr[-1]) else exp_rv_now
    ew21_now = float(ew21_fit_arr[-1]) if np.isfinite(ew21_fit_arr[-1]) else exp_rv_now
    ew_dn10_now = float(ew_dn10_fit_arr[-1]) if np.isfinite(ew_dn10_fit_arr[-1]) else exp_rv_now

    if vrp_mode == "fixed":
        vrp_base_now = float(vrp_fixed_pts)
        fair_m2_now = exp_rv_now + vrp_base_now
        har_now = {"a": vrp_base_now, "b_ew5": 0.0, "b_ew21": 0.0, "b_dn10": 0.0, "r2": 0.0, "is_fallback": True}
    else:
        n_har = min(252, len(df_fit))
        har_now = fit_har_rv(
            ew5_fit_arr[-n_har:],
            ew21_fit_arr[-n_har:],
            ew_dn10_fit_arr[-n_har:],
            vols_fit_arr[-n_har:],
        )
        if not har_now["is_fallback"]:
            fair_m2_now = max(
                8.0,
                har_now["a"] + har_now["b_ew5"] * ew5_now + har_now["b_ew21"] * ew21_now + har_now["b_dn10"] * ew_dn10_now,
            )
            vrp_base_now = fair_m2_now - rv21_now
        else:
            vrp_base_now = DEFAULT_VRP_PTS
            fair_m2_now = exp_rv_now + vrp_base_now

    # Causal rolling 60D-peak drawdowns across df_fit, fitted over 252D with 30D EWM decay
    dates_all = list(df_fit.index)
    spots_all = df_fit["spot"].values.astype(float)
    vols_all = df_fit["vol"].values.astype(float)
    dx_all = np.full(len(spots_all), np.nan, dtype=float)
    dy_all = np.full(len(vols_all), np.nan, dtype=float)
    if len(spots_all) > 1:
        valid_prev = spots_all[:-1] > 0
        safe_prev = np.where(valid_prev, spots_all[:-1], 1.0)
        dx_all[1:] = np.where(valid_prev, (spots_all[1:] - spots_all[:-1]) / safe_prev * 100.0, np.nan)
        dy_all[1:] = vols_all[1:] - vols_all[:-1]
    roll_peak_all = pd.Series(spots_all).rolling(window_days, min_periods=1).max().values.astype(float)
    dd_all = np.maximum(0.0, (roll_peak_all - spots_all) / np.where(roll_peak_all > 0, roll_peak_all, 1.0) * 100.0)
    quad_fit_win = max(window_days, QUAD_FIT_WINDOW_DAYS)

    # Current quadratic fit on trailing 252D of rolling 60D drawdowns (30D EWM half-life)
    quad = fit_quadratic_drawdown(
        spots_all[-quad_fit_win:],
        vols_all[-quad_fit_win:],
        dd_vals=dd_all[-quad_fit_win:],
        half_life=QUAD_EWM_HALF_LIFE_DAYS,
        peak_window=window_days,
    )
    w_m2_now, w_m4_now = _resolve_blend_weights(quad["r2"], blend_mode)

    # Scatter dots remain the recent window_days (60D) sessions anchored against current 60D peak
    w_df = df_fit.iloc[-window_days:] if len(df_fit) >= window_days else df_fit
    spot_arr = w_df["spot"].values.astype(float)
    vol_arr = w_df["vol"].values.astype(float)
    peak_60d = quad["peak"]
    dd_scatter = np.maximum(0.0, (peak_60d - spot_arr) / peak_60d * 100.0) if peak_60d > 0 else np.zeros_like(spot_arr)

    scatter_60d = {
        "dates": list(w_df.index),
        "spot": [round(float(v), 2) for v in spot_arr],
        "vol": [round(float(v), 2) for v in vol_arr],
        "dd_pct": [round(float(v), 2) for v in dd_scatter],
    }

    # Build smooth 50-point curve grid spanning below min spot to slightly above 60D peak
    s_min = float(np.min(spot_arr)) * 0.97
    s_max = peak_60d * 1.01
    grid_spot = np.linspace(s_min, s_max, 50)
    grid_dd = np.maximum(0.0, (peak_60d - grid_spot) / peak_60d * 100.0) if peak_60d > 0 else np.zeros_like(grid_spot)
    grid_quad = quad["c0"] + quad["c1"] * grid_dd + quad["c2"] * (grid_dd ** 2)
    band_pad = max(1.0, quad["std_err"])

    curve = {
        "spot": [round(float(v), 2) for v in grid_spot],
        "dd_pct": [round(float(v), 2) for v in grid_dd],
        "vix_quad": [round(float(v), 2) for v in grid_quad],
        "upper_1sd": [round(float(v + band_pad), 2) for v in grid_quad],
        "lower_1sd": [round(float(max(5.0, v - band_pad)), 2) for v in grid_quad],
    }

    # Precompute point-in-time daily parameters (entering day d_i, strictly using dates < d_i)
    daily_params: Dict[str, Dict[str, Any]] = {}

    for i, d_str in enumerate(dates_all):
        if i < 6:
            continue
        q_start = max(0, i - quad_fit_win)
        prior_d = dates_all[i - 1]
        q_i = fit_quadratic_drawdown(
            spots_all[q_start:i],
            vols_all[q_start:i],
            dd_vals=dd_all[q_start:i],
            half_life=QUAD_EWM_HALF_LIFE_DAYS,
            peak_window=window_days,
        )
        wm2_i, wm4_i = _resolve_blend_weights(q_i["r2"], blend_mode)

        e_rv_i = float(exp_rv_all.loc[prior_d]) if pd.notna(exp_rv_all.loc[prior_d]) else exp_rv_now
        rv21_prior = float(rv21_fit_arr[i - 1]) if np.isfinite(rv21_fit_arr[i - 1]) else e_rv_i
        if vrp_mode == "fixed":
            vrp_i = float(vrp_fixed_pts)
            fair_m2_i = e_rv_i + vrp_i
        else:
            h_start = max(0, i - 252)
            har_i = fit_har_rv(
                ew5_fit_arr[h_start:i],
                ew21_fit_arr[h_start:i],
                ew_dn10_fit_arr[h_start:i],
                vols_all[h_start:i],
            )
            if not har_i["is_fallback"]:
                ew5_p = float(ew5_fit_arr[i - 1]) if np.isfinite(ew5_fit_arr[i - 1]) else e_rv_i
                ew21_p = float(ew21_fit_arr[i - 1]) if np.isfinite(ew21_fit_arr[i - 1]) else e_rv_i
                ew_dn10_p = float(ew_dn10_fit_arr[i - 1]) if np.isfinite(ew_dn10_fit_arr[i - 1]) else e_rv_i
                fair_m2_i = max(
                    8.0,
                    har_i["a"] + har_i["b_ew5"] * ew5_p + har_i["b_ew21"] * ew21_p + har_i["b_dn10"] * ew_dn10_p,
                )
                vrp_i = fair_m2_i - rv21_prior
            else:
                vrp_i = DEFAULT_VRP_PTS
                fair_m2_i = e_rv_i + vrp_i

        beta_slope = None
        beta_intercept = None
        b_start = max(1, i - window_days)
        xb = dx_all[b_start:i]
        yb = dy_all[b_start:i]
        b_mask = np.isfinite(xb) & np.isfinite(yb)
        if int(np.sum(b_mask)) >= 15:
            xb_v = xb[b_mask]
            yb_v = yb[b_mask]
            mean_x = float(np.mean(xb_v))
            mean_y = float(np.mean(yb_v))
            var_x = float(np.sum((xb_v - mean_x) ** 2))
            if var_x > 1e-6:
                raw_sl = float(np.sum((xb_v - mean_x) * (yb_v - mean_y)) / var_x)
                beta_slope = max(-5.0, min(-0.3, raw_sl))
                beta_intercept = float(mean_y - beta_slope * mean_x)

        entry = {
            "peak_60d": round(q_i["peak"], 2),
            "c0": round(q_i["c0"], 4),
            "c1": round(q_i["c1"], 4),
            "c2": round(q_i["c2"], 5),
            "quad_r2": round(q_i["r2"], 4),
            "rv_5d": round(float(rv5_all.loc[prior_d]) if pd.notna(rv5_all.loc[prior_d]) else e_rv_i, 2),
            "rv_10d": round(float(rv10_all.loc[prior_d]) if pd.notna(rv10_all.loc[prior_d]) else e_rv_i, 2),
            "rv_21d": round(rv21_prior, 2),
            "expected_rv": round(e_rv_i, 2),
            "vrp_base": round(vrp_i, 2),
            "fair_m2": round(fair_m2_i, 2),
            "w_m2": round(wm2_i, 4),
            "w_m4": round(wm4_i, 4),
        }
        if beta_slope is not None and beta_intercept is not None:
            entry["beta_slope"] = round(beta_slope, 4)
            entry["beta_intercept"] = round(beta_intercept, 4)
        daily_params[d_str] = entry

    # Include next-session (today live) params under key "__live__" as well as today_et if known
    return {
        "spot_col": spot_col,
        "vol_col": vol_col,
        "last_settled_date": last_fit_date,
        "window_days": window_days,
        "quad_fit_window": quad_fit_win,
        "quad_half_life": QUAD_EWM_HALF_LIFE_DAYS,
        "rv_method": rv_method,
        "rv_5d": round(rv5_now, 2),
        "rv_10d": round(rv10_now, 2),
        "rv_21d": round(rv21_now, 2),
        "expected_rv": round(exp_rv_now, 2),
        "ew_5d": round(ew5_now, 2),
        "ew_21d": round(ew21_now, 2),
        "ew_dn10": round(ew_dn10_now, 2),
        "har_r2": round(float(har_now["r2"]), 4),
        "har_a": round(float(har_now["a"]), 4),
        "har_b_ew5": round(float(har_now["b_ew5"]), 4),
        "har_b_ew21": round(float(har_now["b_ew21"]), 4),
        "har_b_dn10": round(float(har_now["b_dn10"]), 4),
        "vrp_base": round(vrp_base_now, 2),
        "vrp_mode": vrp_mode,
        "fair_m2": round(fair_m2_now, 2),
        "peak_60d": round(quad["peak"], 2),
        "c0": round(quad["c0"], 4),
        "c1": round(quad["c1"], 4),
        "c2": round(quad["c2"], 5),
        "quad_r2": round(quad["r2"], 4),
        "quad_std": round(quad["std_err"], 2),
        "w_m2": round(w_m2_now, 4),
        "w_m4": round(w_m4_now, 4),
        "blend_mode": blend_mode,
        "scatter_60d": scatter_60d,
        "curve": curve,
        "daily_params": daily_params,
    }


def evaluate_live_fair_vix(
    model_pack: Dict[str, Any],
    spot_val: float,
    vol_val: float,
    spot_pct: float = 0.0,
    overvix_resid: float = 0.0,
    threshold_pts: float = 2.0,
) -> Dict[str, Any]:
    """Evaluate real-time Composite Fair VIX, Valuation Gap, Rule-of-16 diagnostics, and Sticky Vol flag."""
    if not model_pack or not spot_val or spot_val <= 0 or not vol_val or vol_val <= 0:
        return {}

    peak = float(model_pack.get("peak_60d", spot_val) or spot_val)
    c0 = float(model_pack.get("c0", vol_val))
    c1 = float(model_pack.get("c1", 0.0))
    c2 = float(model_pack.get("c2", 0.0))
    fair_m2 = float(model_pack.get("fair_m2", vol_val))
    w_m2 = float(model_pack.get("w_m2", 0.5))
    w_m4 = float(model_pack.get("w_m4", 0.5))
    rv_5d = float(model_pack.get("rv_5d", 16.0))
    rv_10d = float(model_pack.get("rv_10d", 16.0))
    rv_21d = float(model_pack.get("rv_21d", 16.0))
    exp_rv = float(model_pack.get("expected_rv", rv_21d))
    vrp_base = float(model_pack.get("vrp_base", DEFAULT_VRP_PTS))

    dd_now = max(0.0, (peak - float(spot_val)) / peak * 100.0) if peak > 0 else 0.0
    fair_m4 = c0 + c1 * dd_now + c2 * (dd_now ** 2)
    composite = w_m2 * fair_m2 + w_m4 * fair_m4

    gap_pts = float(vol_val) - composite
    gap_pct = (gap_pts / composite * 100.0) if composite > 0 else 0.0
    band_low = min(fair_m2, fair_m4)
    band_high = max(fair_m2, fair_m4)

    if gap_pts >= threshold_pts:
        regime = "RICH"
    elif gap_pts <= -threshold_pts:
        regime = "CHEAP"
    else:
        regime = "FAIR"

    sqrt252 = math.sqrt(252.0)
    vrp_live = float(vol_val) - rv_21d
    imp_daily_move_pct = float(vol_val) / sqrt252
    real_daily_move_pct = rv_10d / sqrt252

    is_dual_sticky = bool(gap_pts > 0.0 and float(overvix_resid) > 0.0)
    is_rally_sticky = bool(is_dual_sticky and float(spot_pct) > 0.0)

    return {
        "combined": round(composite, 2),
        "fair_m2_rv_vrp": round(fair_m2, 2),
        "fair_m4_quad": round(fair_m4, 2),
        "band_low": round(band_low, 2),
        "band_high": round(band_high, 2),
        "gap_pts": round(gap_pts, 2),
        "gap_pct": round(gap_pct, 1),
        "regime": regime,
        "rv_5d": round(rv_5d, 2),
        "rv_10d": round(rv_10d, 2),
        "rv_21d": round(rv_21d, 2),
        "expected_rv": round(exp_rv, 2),
        "ew_5d": round(float(model_pack.get("ew_5d", rv_5d)), 2),
        "ew_21d": round(float(model_pack.get("ew_21d", rv_21d)), 2),
        "ew_dn10": round(float(model_pack.get("ew_dn10", rv_10d)), 2),
        "har_r2": round(float(model_pack.get("har_r2", 0.0)), 4),
        "vrp_base": round(vrp_base, 2),
        "vrp_live": round(vrp_live, 2),
        "vrp_mode": model_pack.get("vrp_mode", "auto"),
        "rv_method": model_pack.get("rv_method", "Close-to-Close"),
        "peak_60d": round(peak, 2),
        "drawdown_pct": round(dd_now, 2),
        "quad_c0": round(c0, 2),
        "quad_c1": round(c1, 2),
        "quad_c2": round(c2, 4),
        "quad_r2": round(float(model_pack.get("quad_r2", 0.0)), 4),
        "quad_std": round(float(model_pack.get("quad_std", 1.5)), 2),
        "w_m2": round(w_m2, 2),
        "w_m4": round(w_m4, 2),
        "blend_mode": model_pack.get("blend_mode", "r2_weighted"),
        "implied_daily_move_pct": round(imp_daily_move_pct, 2),
        "realized_daily_move_pct": round(real_daily_move_pct, 2),
        "is_dual_sticky": is_dual_sticky,
        "is_rally_sticky": is_rally_sticky,
        "live_spot": round(float(spot_val), 2),
        "live_vol": round(float(vol_val), 2),
    }
