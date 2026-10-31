# Proposal: Contexto de cron y consumo

## Why

Hay tres problemas que van juntos:

1. **La configuración por ejecución no se está aplicando.** El overlay de MCPs viaja en
   `OPENCODE_CONFIG_CONTENT`, pero `opencode run` solo lo respeta con `--standalone`. Sin ese flag
   usa el servicio en segundo plano, que no hereda la variable, así que los MCPs elegidos se
   ignoran en silencio.
2. **El modelo se comporta como en un chat.** Al no haber una instrucción de sistema que diga que
   es una tarea programada, puede saludar, pedir confirmación o preguntar cosas que nadie va a
   responder. Eso gasta tokens y ensucia el historial.
3. **No hay visibilidad del gasto.** El historial guarda la salida y la duración, pero no los
   tokens ni el coste, así que no se puede saber cuánto consume un cron.

## What Changes

- El runner `opencode` pasa a usar **`--standalone`** en todas las ejecuciones: servidor privado por
  run, configuración inline aplicada de verdad y aislamiento del opencode del usuario.
- Se añade una **instrucción de cron oculta**, fija y no editable desde la ventana, inyectada con
  `instructions` en `OPENCODE_CONFIG_CONTENT`. No se guarda como mensaje ni se muestra en el chat.
- Cada ejecución guarda **tokens y coste** leídos de `opencode session export` después del run
  (entrada, salida, razonamiento, caché y coste en USD).
- La ventana muestra el **consumo total del cron** y columnas de tokens/coste por ejecución.

No hay cambios incompatibles: los crons existentes siguen funcionando; las ejecuciones antiguas
quedan sin datos de consumo (`—`).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `run-execution`: ejecución aislada con `--standalone` e instrucción de cron oculta.
- `run-history`: consumo por ejecución y totales por cron.
- `desktop-app`: tarjeta de consumo y columnas de tokens/coste.

## Impact

- Código: `packages/core/src/runners/opencode.ts` y un módulo nuevo de instrucciones;
  `packages/core/src/runners/opencode-events.ts` o un parser de sesión; `packages/core/src/db`;
  `packages/daemon/src/api`; `packages/ui`.
- Datos: columnas nuevas y nullables en `runs` (`input_tokens`, `output_tokens`,
  `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`).
- Dependencias: ninguna nueva.
- Rendimiento: `--standalone` arranca un servidor privado por ejecución (unos segundos y algo más
  de RAM); el export de sesión añade una llamada por run. A cambio, el aislamiento y la
  configuración por cron son reales.
- Fuera de alcance: calcular precios propios, presupuestos o alertas de gasto; y renderizar Markdown
  (va en el cambio `render-chat-markdown`).
