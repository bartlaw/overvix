import asyncio
from ib_async import IB, Index, util
import pandas as pd
from session_history import fetch_and_build_historical_session, get_cached_dates, load_cached_session

async def main():
    ib = IB()
    try:
        await ib.connectAsync('127.0.0.1', 7496, clientId=96)
        c_spx = Index('SPX', 'CBOE')
        c_vix = Index('VIX', 'CBOE')
        c_vix3m = Index('VIX3M', 'CBOE')
        await ib.qualifyContractsAsync(c_spx, c_vix, c_vix3m)
        
        # 1. Fetch 1Y daily bars for daily reference
        b_s = await ib.reqHistoricalDataAsync(c_spx, endDateTime='', durationStr='252 D', barSizeSetting='1 day', whatToShow='TRADES', useRTH=True)
        b_v = await ib.reqHistoricalDataAsync(c_vix, endDateTime='', durationStr='252 D', barSizeSetting='1 day', whatToShow='TRADES', useRTH=True)
        b_v3 = await ib.reqHistoricalDataAsync(c_vix3m, endDateTime='', durationStr='252 D', barSizeSetting='1 day', whatToShow='TRADES', useRTH=True)
        
        df_spx_daily = util.df(b_s).set_index('date')['close'].rename('spx')
        df_vix_daily = util.df(b_v).set_index('date')['close'].rename('vix')
        df_v3_daily = util.df(b_v3).set_index('date')['close'].rename('vix3m')
        df_daily = pd.concat([df_spx_daily, df_vix_daily, df_v3_daily], axis=1).dropna()
        
        target = '2026-10-22'
        print(f"Testing session retrieval for {target}...")
        payload = await fetch_and_build_historical_session(
            ib=ib,
            spx_contract=c_spx,
            vix_contract=c_vix,
            vix3m_contract=c_vix3m,
            df_daily=df_daily,
            target_date=target
        )
        
        print("\nSession Build Succeeded!")
        print(f"Session date: {payload['session_date']}, bars: {payload['session_bars']}")
        print(f"SPX close: {payload['market']['spx']['current']} ({payload['market']['spx']['pct_change']}%)")
        print(f"VIX close: {payload['market']['vix']['current']} ({payload['market']['vix']['pt_change']} pts)")
        print(f"Residual: {payload['overvix']['residual_pts']} pts -> {payload['overvix']['status']}")
        print(f"Ratio: {payload['term_structure']['ratio']} -> {payload['term_structure']['regime']}")
        print(f"Rolling rho: {payload['correlation']['rolling_corr']}")
        print(f"Confluence: {payload['confluence']['tag']}")
        
        # Test loading from cache
        print("\nTesting cache retrieval...")
        cached_dates = get_cached_dates()
        print(f"Cached dates: {cached_dates}")
        cached = load_cached_session(target)
        assert cached is not None, "Cache should not be None"
        print("Cache verification passed!")
        
        ib.disconnect()
    except Exception as e:
        print("Error during test:", e)
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(main())
