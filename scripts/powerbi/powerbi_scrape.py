"""
powerbi_scrape.py — Captura automática de datos Power BI

Primera vez:  python3 powerbi_scrape.py --login    (login manual, guarda cookies)
Después:      python3 powerbi_scrape.py             (automático con cookies guardadas)

Guarda JSONs en powerbi_data/ con los datos de cada página.
"""
import asyncio
import json
import os
import sys
from datetime import datetime

REPORT_URL = "https://app.powerbi.com/groups/me/reports/b6a1aae4-feb4-4387-92de-fa4b093ba395"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "powerbi_data")
COOKIES_FILE = os.path.join(SCRIPT_DIR, "powerbi_cookies.json")

# IDs reales de las páginas del reporte
PAGES = {
    "Disponibilidad": "02312e3e65e78773ef67",
    "Bitacora Historica": "b84f92ee17696568ab1c",
    "HHaH": "abb943787701c349af02",
    "HaH Turno": "b6d0065d40825e3cd93c",
    "LHD 1-20": "5abfa95d1a27b8caa329",
    "LHD 21-30": "006eca07593626c97377",
    "Jumbo": "30274e57e404a85001a0",
    "Inicio": "d7fed5c06e69af044221",
    "Taller": "c240bef858751b5f281d",
    "Actividades": "14e122468e5553e9a67b",
}


async def do_login():
    """Login manual — abre browser, guardas cookies al terminar."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(viewport={"width": 1400, "height": 900})
        page = await context.new_page()
        await page.goto(REPORT_URL, wait_until="domcontentloaded")

        print("═══════════════════════════════════════")
        print("  Haz login con tu cuenta Codelco.")
        print("  Espera que el reporte cargue completo.")
        print("  Después presiona ENTER aquí.")
        print("═══════════════════════════════════════")
        input("\n>>> ENTER cuando esté cargado... ")

        cookies = await context.cookies()
        with open(COOKIES_FILE, "w") as f:
            json.dump(cookies, f, indent=2)
        print(f"✓ Cookies guardadas ({len(cookies)} cookies)")
        # También guardar storage state completo
        state = await context.storage_state()
        with open(COOKIES_FILE.replace(".json", "_state.json"), "w") as f:
            json.dump(state, f, indent=2)
        print("✓ Session state guardado")

        await browser.close()


async def capture_auto(pages_to_capture=None):
    """Captura automática usando cookies guardadas."""
    from playwright.async_api import async_playwright

    state_file = COOKIES_FILE.replace(".json", "_state.json")
    if not os.path.exists(state_file):
        print("✗ No hay session guardada. Ejecuta primero:")
        print("  python3 powerbi_scrape.py --login")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    targets = pages_to_capture or list(PAGES.keys())
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    all_data = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            storage_state=state_file,
            viewport={"width": 1920, "height": 1080}
        )

        for page_name in targets:
            page_id = PAGES.get(page_name)
            if not page_id:
                print(f"  ✗ Página desconocida: {page_name}")
                continue

            print(f"\n── {page_name} ──")
            responses = []

            page = await context.new_page()

            async def on_response(response):
                url = response.url
                if ("analysis.windows.net" in url or "pbidedicated" in url) and response.status == 200:
                    try:
                        body = await response.body()
                        if len(body) > 500:
                            try:
                                parsed = json.loads(body)
                            except Exception:
                                parsed = None
                            if parsed:
                                endpoint = url.split("/")[-1].split("?")[0]
                                responses.append({
                                    "endpoint": endpoint,
                                    "size": len(body),
                                    "data": parsed
                                })
                                tag = "DATA" if len(body) > 5000 else "    "
                                print(f"  {tag} {endpoint} ({len(body)/1024:.1f}KB)")
                    except Exception:
                        pass

            page.on("response", on_response)

            url = f"{REPORT_URL}/{page_id}"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                # Esperar que los visuals carguen sus datos
                await page.wait_for_timeout(15000)
            except Exception as e:
                print(f"  ✗ Error navegando: {e}")
                # Session expirada?
                if "login" in str(page.url).lower() or "unauthorized" in str(e).lower():
                    print("  ⚠ Session expirada. Ejecuta: python3 powerbi_scrape.py --login")
                    await browser.close()
                    sys.exit(1)

            await page.close()

            if responses:
                all_data[page_name] = responses
                total_kb = sum(r["size"] for r in responses) / 1024
                print(f"  ✓ {len(responses)} responses ({total_kb:.1f} KB)")
            else:
                print(f"  ✗ Sin datos capturados")

        await browser.close()

    # Guardar resultados
    filepath = os.path.join(OUTPUT_DIR, f"capture_{timestamp}.json")
    output = {
        "timestamp": timestamp,
        "pages_captured": list(all_data.keys()),
        "data": {}
    }
    for page_name, responses in all_data.items():
        output["data"][page_name] = responses

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)

    total_size = os.path.getsize(filepath) / 1024
    print(f"\n═══ RESUMEN ═══")
    print(f"✓ Guardado: {filepath} ({total_size:.1f} KB)")
    for page_name in all_data:
        n = len(all_data[page_name])
        kb = sum(r["size"] for r in all_data[page_name]) / 1024
        print(f"  {page_name}: {n} responses ({kb:.1f} KB)")

    return filepath


async def main():
    if "--login" in sys.argv:
        await do_login()
        print("\nAhora puedes ejecutar automáticamente:")
        print("  python3 powerbi_scrape.py")
    else:
        # Filtrar páginas específicas si se pasan
        pages = None
        for i, arg in enumerate(sys.argv[1:]):
            if arg == "--pages":
                pages = sys.argv[i + 2].split(",")
        await capture_auto(pages)


if __name__ == "__main__":
    asyncio.run(main())
