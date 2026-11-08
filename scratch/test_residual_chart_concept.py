import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1400, "height": 900})
        await page.goto("http://127.0.0.1:8000")
        await page.wait_for_selector("#correlation-chart .js-plotly-plot", timeout=15000)
        
        res = await page.evaluate('''() => {
            const chart = document.getElementById('correlation-chart');
            return {
                dataLength: chart.data.length,
                traceNames: chart.data.map(d => d.name)
            };
        }''')
        print("Chart current traces:", res)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
