import urllib.request
import json
import time

time.sleep(2)

def test_endpoint(url, payload):
    print(f"\n--- Testing {url} with {payload} ---")
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode('utf-8')
            print("Status:", resp.status)
            print("Response:", body)
            return True
    except Exception as e:
        print("Error:", e)
        if hasattr(e, 'read'):
            print("Server error body:", e.read().decode('utf-8', errors='ignore'))
        return False

# 1. 25d SPX spot
test_endpoint('http://127.0.0.1:8082/api/recalibrate_25d_skew', {'asset': 'SPX', 'mode': 'spot'})
# 2. 25d SPX reset (session_close)
test_endpoint('http://127.0.0.1:8082/api/recalibrate_25d_skew', {'asset': 'SPX', 'mode': 'session_close'})
# 3. 4m SPX spot
test_endpoint('http://127.0.0.1:8082/api/recalibrate_4m_skew', {'asset': 'SPX', 'mode': 'spot'})
