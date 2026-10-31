# Tasks

## 1. Catálogo de opencode

- [x] 1.1 Implementar `packages/daemon/src/opencode-options.ts` con modelos de `opencode models`, nombres y variantes de `~/.cache/opencode/models.json`, agentes de `opencode debug agents`, cache de 60 s y parser tolerante, y verificar con tests que excluye subagentes y campos `system`
- [x] 1.2 Exponer `GET /api/opencode/options` con token y `?refresh=1`, y verificar que sin token devuelve 401, con token 200 y que el JSON contiene modelos, variantes y agentes primarios

## 2. Formulario: modelo, variante y agente

- [x] 2.1 Cargar el catálogo en el formulario y mostrar selects de modelo, variante y agente con opción «Personalizado» y botón de recarga, y verificar que al guardar se envía `proveedor/modelo#variante`
- [x] 2.2 Implementar la degradación a campos de texto cuando el catálogo no está disponible, y verificar con el endpoint simulado caído que el formulario avisa y sigue guardando

## 3. Zona horaria

- [x] 3.1 Sustituir el campo de texto por un selector buscable con `UTC`, la zona del sistema y las zonas IANA (con lista de respaldo), y verificar que se guarda exactamente el id elegido
- [x] 3.2 Mostrar la hora actual y el desfase de la zona elegida, y verificar con `UTC` y `Europe/Madrid` que el texto y el desfase cambian

## 4. Cron por campos

- [x] 4.1 Implementar `packages/ui/src/cron.ts` con `parseCron`, `composeCron` y `describeCron`, y verificar con tests unitarios los cinco campos, los presets y las expresiones inválidas
- [x] 4.2 Sustituir el campo único por cinco controles con presets, vista previa y modo avanzado, y verificar que un cron existente se carga en los campos y que una expresión no interpretable abre el modo avanzado con aviso

## 5. Integración y documentación

- [x] 5.1 Probar en la ventana real el flujo completo (modelo, variante, agente primario, zona `UTC` y cron por campos) y verificar que la API y la base de datos guardan `modelo#variante`, `UTC` y `0 9 * * 1-5`
- [x] 5.2 Actualizar `README.md` y `~/Documents/Documentation/LAICron.md` con el nuevo formulario, y verificar que los pasos y comandos documentados existen
- [x] 5.3 Ejecutar `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` y `openspec validate improve-job-form-usability`, y verificar que todo pasa

## Workflow follow-up

- Archivar el cambio con `openspec archive improve-job-form-usability` cuando la implementación esté verificada.
