# KPI Confiabilidad — Veltis

Dashboard de confiabilidad y disponibilidad de equipos mineros (jumbos, picarrocas, martillos) a partir de los informes turno a turno.

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/` | Servidor Node.js + Express (`server.js`) |
| `public/` | Páginas, CSS, JS y assets que ve el navegador |
| `scripts/` | Ingesta a la base (`sync_turnos.js`), cálculo de horas (`horas_turno.js`) y utilitarios |
| `scripts/powerbi/` | Captura de datos desde Power BI |
| `control/` | Control semanal de los informes: detecta errores y genera copias corregidas |
| `tests/` | Pruebas (`npm test`) |
| `docs/` | Reglas de negocio y arquitectura |
| `supabase/` | Configuración de Supabase CLI |
| `data/` | Datos locales. **No se versiona.** |

## Puesta en marcha

```bash
npm install
cp .env.example .env      # completar DATABASE_URL, JWT_SECRET y GROQ_API_KEY
npm run dev               # http://localhost:3000
npm test
```

## Flujo semanal de datos

1. Los supervisores llenan la hoja `Reporte` de cada informe turno a turno.
2. `control/control_semanal.py --semana N` revisa los informes, aplica las reglas de `docs/reglas-limpieza.md` y deja copias corregidas.
3. `node scripts/sync_turnos.js --src=<carpeta corregida>` calcula las horas fuera de servicio sin doble conteo y reemplaza la semana en la base. Usar `--dry` para ensayar.

## Seguridad y datos

- Las claves van solo en `.env` (ignorado por git) o en las variables de entorno del servicio.
- Excel, bases de datos, cookies y chats de WhatsApp están en `.gitignore`: este repositorio contiene código, no información operacional.
- La rama `main` se cambia solo por pull request; el CI (`infra/ci.yml`, se activa copiándolo a `.github/workflows/`) ejecuta las pruebas.
