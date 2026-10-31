# Proposal: Formulario de cron asistido

## Why

El formulario actual pide como texto libre el modelo, el agente, la zona horaria y la expresión
cron. Son cuatro cadenas donde un error de tecleo no se nota hasta que el cron falla o se ejecuta
a la hora equivocada: `0 9 * * 1-5` y `0 9 * * 1,5` parecen lo mismo, `Europe/Madrid` y
`Europe/Madridd` también, y un modelo mal escrito solo se descubre cuando `opencode` termina con
error. Además, `opencode` ya conoce sus modelos, sus variantes y sus agentes; pedírselos al humano
es trasladarle un trabajo que la máquina puede hacer mejor.

## What Changes

- Nuevo endpoint local `GET /api/opencode/options` que devuelve modelos (con nombre legible y
  variantes), agentes primarios y un indicador de disponibilidad.
- El formulario pasa a ofrecer **listas** para modelo, variante y agente, con una opción
  «Personalizado…» para seguir admitiendo valores manuales.
- La variante se codifica en el campo `model` existente como `proveedor/modelo#variante`; no hay
  cambio de esquema.
- La zona horaria pasa de texto libre a un selector buscable con `UTC`, la zona del sistema y todas
  las zonas IANA, con la hora actual y el desfase visibles.
- La expresión cron pasa de un único campo a cinco campos (minuto, hora, día del mes, mes y día de
  la semana), con presets, vista previa en lenguaje natural y un modo avanzado para editar la
  expresión cruda.
- Si `opencode` no está instalado o el catálogo no se puede leer, el formulario degrada a los
  campos de texto actuales y lo avisa; nunca se queda sin poder crear un cron.

No hay cambios incompatibles: los crons existentes siguen guardando los mismos valores y la API de
jobs no cambia.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `desktop-app`: el formulario de creación y edición DEBE ofrecer selección asistida de modelo,
  variante, agente, zona horaria y campos de cron, y DEBE degradar a entrada manual si el catálogo
  no está disponible.

## Impact

- Código: `packages/daemon/src/opencode-options.ts` (nuevo), una ruta en
  `packages/daemon/src/api/index.ts`, `packages/ui/src/cron.ts` (nuevo) y el formulario de la SPA.
- Dependencias: ninguna nueva. Se usan `opencode models`, `opencode debug agents`, el cache local
  `~/.cache/opencode/models.json` e `Intl.supportedValuesOf`.
- Datos: sin migración. `model` sigue siendo texto y admite el sufijo `#variante`.
- Documentación: se actualizan el README y la guía de `~/Documents/Documentation`.
- Fuera de alcance: cambiar el motor de ejecución, el esquema de la base de datos o el formato de
  las expresiones cron almacenadas.
