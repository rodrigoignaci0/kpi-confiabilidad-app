"""
powerbi_connect.py — Conectar a Power BI API con credenciales de usuario
Usa el Client ID público de Power BI Desktop (sin registrar app en Azure AD)

Uso:
  python3 powerbi_connect.py          # Login interactivo + explorar reporte
  python3 powerbi_connect.py --test   # Solo probar autenticación
"""
import sys
import json
import msal
import requests

# Power BI Desktop public client ID (registrado por Microsoft)
CLIENT_ID = "23d8f6bd-1eb0-4cc2-a08c-7bf525c67bcd"
AUTHORITY = "https://login.microsoftonline.com/common"
SCOPES = ["https://analysis.windows.net/powerbi/api/.default"]

# Tu reporte
REPORT_ID = "b6a1aae4-feb4-4387-92de-fa4b093ba395"
API_BASE = "https://api.powerbi.com/v1.0/myorg"


def authenticate():
    """Login interactivo — abre browser para autenticar con tu cuenta Codelco."""
    app = msal.PublicClientApplication(CLIENT_ID, authority=AUTHORITY)

    # Intentar cache primero
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(SCOPES, account=accounts[0])
        if result and "access_token" in result:
            print("✓ Token desde cache")
            return result["access_token"]

    # Login interactivo (abre browser)
    print("Abriendo browser para login...")
    print("Usa tu cuenta corporativa de Codelco")
    result = app.acquire_token_interactive(scopes=SCOPES)

    if "access_token" in result:
        print("✓ Autenticación exitosa")
        return result["access_token"]
    else:
        print("✗ Error:", result.get("error_description", result.get("error", "desconocido")))
        sys.exit(1)


def api_get(token, endpoint):
    """GET request a Power BI API."""
    r = requests.get(
        f"{API_BASE}{endpoint}",
        headers={"Authorization": f"Bearer {token}"}
    )
    if r.status_code != 200:
        print(f"Error {r.status_code}: {r.text[:500]}")
        return None
    return r.json()


def api_post(token, endpoint, body):
    """POST request a Power BI API."""
    r = requests.post(
        f"{API_BASE}{endpoint}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        json=body
    )
    if r.status_code != 200:
        print(f"Error {r.status_code}: {r.text[:500]}")
        return None
    return r.json()


def explore_report(token):
    """Explorar el reporte: metadata, datasets, páginas."""
    print("\n═══ REPORTE ═══")
    report = api_get(token, f"/reports/{REPORT_ID}")
    if report:
        print(f"  Nombre: {report.get('name')}")
        print(f"  Dataset: {report.get('datasetId')}")
        dataset_id = report.get("datasetId")
    else:
        print("  No se pudo acceder al reporte")
        return

    print("\n═══ PÁGINAS ═══")
    pages = api_get(token, f"/reports/{REPORT_ID}/pages")
    if pages and "value" in pages:
        for p in pages["value"]:
            print(f"  - {p.get('displayName')} (order: {p.get('order')})")

    print("\n═══ DATASET INFO ═══")
    if dataset_id:
        ds = api_get(token, f"/datasets/{dataset_id}")
        if ds:
            print(f"  Nombre: {ds.get('name')}")
            print(f"  Configuración: {json.dumps(ds, indent=2, default=str)[:1000]}")

        # Intentar listar tablas
        print("\n═══ TABLAS ═══")
        tables = api_get(token, f"/datasets/{dataset_id}/tables")
        if tables and "value" in tables:
            for t in tables["value"]:
                print(f"  - {t.get('name')}")
        else:
            print("  (No se pudo listar tablas — puede requerir permisos Build)")

        # Intentar DAX query simple
        print("\n═══ DAX TEST ═══")
        dax_result = api_post(token, f"/datasets/{dataset_id}/executeQueries", {
            "queries": [{"query": "EVALUATE ROW(\"test\", 1)"}],
            "serializerSettings": {"includeNulls": True}
        })
        if dax_result:
            print("  ✓ DAX funciona — puedes extraer datos")
            print(f"  Resultado: {json.dumps(dax_result, indent=2)[:500]}")
        else:
            print("  ✗ DAX no disponible (necesitas permiso Build en el dataset)")


def main():
    token = authenticate()

    if "--test" in sys.argv:
        print("Token obtenido correctamente. Longitud:", len(token))
        return

    explore_report(token)


if __name__ == "__main__":
    main()
