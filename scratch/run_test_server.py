import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

# Create a test app using the exact same static files and mock bootstrap
app = FastAPI()
static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static')
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(static_dir, 'index.html'))

@app.get("/api/status")
async def get_status():
    return {"status": "ok"}

@app.get("/api/available-dates")
async def get_dates():
    return {"min_date": "2024-01-01", "max_date": "2026-11-09", "notable": [], "cached": []}

# Load an actual cached bootstrap payload or minimal valid payload
import json
@app.get("/api/bootstrap")
async def get_bootstrap():
    # Return minimal valid bootstrap
    return {
        "session_date": "2026-11-06",
        "is_rth_active": False,
        "hist_version": 1,
        "model": {"threshold_pts": 2.0, "window_days": 60, "slope": -1.98, "intercept": 0.05, "r_squared": 0.82},
        "overvix": {
            "x_history": [0.1, -0.2, 0.5],
            "y_history": [-0.5, 0.8, -1.2],
            "dates": ["2026-11-04", "2026-11-05", "2026-11-06"],
            "live_x": 0.35, "live_y": -0.4,
            "intraday_trail": {"x": [0.1, 0.2, 0.35], "y": [-0.1, -0.3, -0.4], "times": ["09:30", "12:00", "16:00"]}
        },
        "term_structure": {
            "1D": {"times": ["09:30", "12:00", "16:00"], "vix": [15.2, 15.5, 15.1], "vix3m": [17.1, 17.0, 16.9], "ratio": [0.89, 0.91, 0.89]}
        },
        "intraday_correlation": {
            "1D": {"times": ["09:30", "12:00", "16:00"], "dates": ["09:30", "12:00", "16:00"], "spx_pct": [0.1, 0.2, 0.35], "vix_pt": [-0.1, -0.3, -0.4], "spot_raw": [5900, 5910, 5920], "vol_raw": [15.2, 15.5, 15.1], "rolling_corr": [-0.7, -0.8, -0.75]},
            "metrics": {"1D": -0.75}
        },
        "tech_vol": {
            "1D": {"times": ["09:30", "12:00", "16:00"], "dates": ["09:30", "12:00", "16:00"], "spread": [2.1, 2.3, 2.0], "ratio": [1.13, 1.14, 1.13], "vxn": [17.3, 17.8, 17.1], "vix": [15.2, 15.5, 15.1]}
        },
        "ndx": {
            "model": {"threshold_pts": 2.5, "slope": -1.37, "intercept": 0.08, "r_squared": 0.70},
            "overvix": {
                "x_history": [0.2, -0.3, 0.6],
                "y_history": [-0.6, 0.9, -1.4],
                "dates": ["2026-11-04", "2026-11-05", "2026-11-06"],
                "live_x": 0.45, "live_y": -0.5,
                "intraday_trail": {"x": [0.2, 0.3, 0.45], "y": [-0.2, -0.4, -0.5], "times": ["09:30", "12:00", "16:00"]}
            },
            "correlation": {
                "current_corr": -0.72,
                "1D": {"times": ["09:30", "12:00", "16:00"], "dates": ["09:30", "12:00", "16:00"], "spx_pct": [0.2, 0.3, 0.45], "vix_pt": [-0.2, -0.4, -0.5], "spot_raw": [20000, 20100, 20200], "vol_raw": [17.3, 17.8, 17.1], "rolling_corr": [-0.7, -0.75, -0.72]},
                "metrics": {"1D": -0.72}
            }
        },
        "live": {
            "spx_price": 5920.0, "vix_price": 15.1, "vix3m_price": 16.9,
            "ndx_price": 20200.0, "vxn_price": 17.1,
            "spx_pct": 0.35, "vix_pt": -0.4, "ndx_pct": 0.45, "vxn_pt": -0.5,
            "overvix_residual": -0.2, "ndx_residual": -0.3,
            "ts_ratio": 0.89, "tech_spread": 2.0, "tech_ratio": 1.13
        }
    }

if __name__ == '__main__':
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
