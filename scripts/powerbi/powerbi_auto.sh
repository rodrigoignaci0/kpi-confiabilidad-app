#!/bin/bash
# powerbi_auto.sh — Captura Power BI, parsea y sube a Supabase
# Se ejecuta automáticamente cada 30 min via cron
cd "$(dirname "$0")/../.."

LOG="powerbi_data/auto.log"
echo "$(date): Iniciando captura..." >> "$LOG"

# 1. Capturar (headless, usa cookies guardadas)
python3 powerbi_scrape.py >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
  echo "$(date): ERROR en scrape — session expirada? Ejecuta: python3 powerbi_scrape.py --login" >> "$LOG"
  exit 1
fi

# 2. Parsear
python3 powerbi_parse.py >> "$LOG" 2>&1

# 3. Subir a Supabase
node powerbi_sync.js >> "$LOG" 2>&1

echo "$(date): OK" >> "$LOG"
