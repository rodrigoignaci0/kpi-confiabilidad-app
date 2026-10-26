# Reglas de limpieza de los informes turno a turno

Las correcciones se hacen en la hoja `Reporte`; `BD_Ejecución`, `BD_Indisponibilidad` y `BD_Diario_CMC` se calculan desde ella.

## Indisponibilidad
- El intervalo de indisponibilidad es **Horario de Aviso → Horario de Entrega**. Las horas de trabajo real (Inicio/Término) no cuentan.
- Turno A: 08:00–20:00. Turno B: 20:00–08:00. Un equipo no puede sumar más de 12 h por turno.
- Si dos registros se solapan, cada minuto se cuenta una vez. Prioridad: falla / no planificado, luego interferencia, luego planificado (`scripts/horas_turno.js`).

## Traspaso de turno
- Si un equipo cierra fuera de servicio (preliminar de WhatsApp), su Entrega es el fin del turno saliente y el Aviso del entrante es el inicio de su turno.

## Clasificación
- Espera de operador, de conexión a red eléctrica, de energía o equipo no conectado: **interferencia operacional**.
- Mantención preventiva no se marca como falla.

## Plantilla
- Las fórmulas de las hojas BD que apuntan a una fila equivocada de `Reporte` se corrigen (el control las detecta como `formula_fila_desfasada`).
