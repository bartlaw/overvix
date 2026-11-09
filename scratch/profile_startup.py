import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
from datetime import datetime
from dashboard import state, connect_and_init_ibkr, get_bootstrap, DEFAULT_IBKR_HOST, DEFAULT_IBKR_PORT

async def test_full_startup():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Testing optimized startup...")
    t0 = time.time()
    
    t_conn_start = time.time()
    res = await connect_and_init_ibkr(DEFAULT_IBKR_HOST, DEFAULT_IBKR_PORT, 93)
    t_conn_end = time.time()
    print(f"---> connect_and_init_ibkr took: {t_conn_end - t_conn_start:.2f}s (result={res})")
    
    t_boot_start = time.time()
    boot = await get_bootstrap()
    t_boot_end = time.time()
    import json
    boot_json = json.dumps(boot)
    print(f"---> get_bootstrap took: {t_boot_end - t_boot_start:.2f}s (payload size: {len(boot_json)/1024:.1f} KB)")
    
    print(f"Total backend startup time: {time.time() - t0:.2f}s")
    if state.ib and state.ib.isConnected():
        state.ib.disconnect()

if __name__ == '__main__':
    asyncio.run(test_full_startup())
