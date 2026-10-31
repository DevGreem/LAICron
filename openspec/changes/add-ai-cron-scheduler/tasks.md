# Tasks

## 1. Base del proyecto

- [x] 1.1 Crear el workspace de pnpm con `packages/core`, `packages/daemon`, `packages/ui` y `packages/platform`, y verificar que `pnpm install` y `pnpm build` terminan sin errores
- [x] 1.2 Configurar TypeScript en modo estricto y el runner de tests (Vitest), y verificar que `pnpm test` ejecuta una prueba de humo y pasa
- [x] 1.3 Añadir el linting y el formato (ESLint + Prettier) y verificar que `pnpm lint` pasa sobre el esqueleto vacío

## 2. Persistencia

- [x] 2.1 Crear el esquema SQLite (`jobs`, `runs`, `messages`) con índices y modo WAL, y verificar con un test que las tablas y los índices existen tras inicializar una base temporal
- [x] 2.2 Implementar el repositorio de crons (crear, listar, editar, borrar, pausar) y verificar con tests de CRUD y de validación de campos obligatorios
- [x] 2.3 Implementar el repositorio de ejecuciones y mensajes, con paginación y retención por antigüedad y número, y verificar que al superar el límite se borran las más antiguas

## 3. Programación

- [x] 3.1 Implementar el cálculo de la próxima ejecución para cron, intervalo y fecha única, en UTC y con zona horaria explícita, y verificar con tests de adelanto y atraso de hora
- [x] 3.2 Implementar el bucle de reloj con reloj inyectable, y verificar con un reloj falso que un cron vencido se dispara y que `next_run_at` se recalcula desde ahora
- [x] 3.3 Implementar la recuperación al arrancar con políticas `none`, `once` y `all` y tope configurable, y verificar con tests que cinco días apagado con `once` produce una sola ejecución
- [x] 3.4 Marcar como interrumpidas las ejecuciones que quedaron en curso al detenerse el daemon, y verificar con un test que al reiniciar cambian de estado

## 4. Runners

- [x] 4.1 Definir la interfaz `Runner` e implementar el runner `shell` con captura de salida y código, y verificar con un test que ejecuta `echo` y con otro que ejecuta un comando inexistente
- [x] 4.2 Implementar el runner `opencode` con `--format json`, parseo tolerante de eventos y extracción del texto, y verificar con un fixture grabado y una prueba de humo contra `opencode run` real
- [x] 4.3 Implementar el tiempo máximo con terminación del árbol de procesos, y verificar con un test que un `sleep` largo termina marcado como `timeout`

## 5. Motor de ejecución

- [x] 5.1 Implementar las políticas de solapamiento `skip`, `queue` y `kill`, y verificar con tests que el segundo disparo se omite, espera o termina el primero según la política
- [x] 5.2 Implementar el límite global de dos ejecuciones de IA con cola FIFO, y verificar con un test que tres crons simultáneos ejecutan dos y encolan el tercero
- [x] 5.3 Registrar cada ejecución con disparador (`scheduled`, `catch_up`, `manual`), estado y duración, y verificar con tests que los tres disparadores quedan reflejados

## 6. API local

- [x] 6.1 Levantar el servidor HTTP en `127.0.0.1` con token en fichero `0600`, y verificar que una petición sin token devuelve 401 y con token devuelve 200
- [x] 6.2 Implementar los endpoints de crons (listar, crear, editar, borrar, pausar y ejecutar ahora), y verificar con `curl` que cada operación cambia el estado esperado
- [x] 6.3 Implementar los endpoints de historial y mensajes con paginación y el canal SSE de eventos, y verificar que al ejecutar un cron llega un evento y que la página siguiente devuelve datos distintos

## 7. Notificaciones

- [x] 7.1 Implementar el `Notifier` con `notify-send`, incluyendo nombre, estado, duración y resumen, y verificar con una notificación real en GNOME y con un test que usa un binario falso
- [x] 7.2 Implementar la opción `notify_on` (`always`, `failure`, `success`) y el fallo no fatal cuando no hay bus, y verificar con tests que no se avisa cuando no toca y que la ejecución no falla sin bus

## 8. Interfaz de escritorio

- [x] 8.1 Crear la SPA con la lista de crons, próxima ejecución y último estado, y verificar que el daemon la sirve en `/` y que muestra los datos de la API
- [x] 8.2 Implementar el formulario de creación y edición con selector de repetición, catch-up, notificación y timeout, y verificar creando un cron desde la ventana y viéndolo en la lista
- [x] 8.3 Implementar la vista de detalle con historial, chat por cron y botón "ejecutar ahora", y verificar que una ejecución manual aparece en el historial y en el chat
- [x] 8.4 Implementar el lanzador de ventana GTK3 + WebKit2 4.1, y verificar que abre la UI, que cerrar la ventana no detiene el daemon y que vuelve a abrirse sin errores

## 9. Instalación y documentación

- [x] 9.1 Crear la unidad systemd `--user` y `install.sh`, y verificar que `systemctl --user status laicron` queda activo y que tras reiniciar el equipo sigue activo
- [x] 9.2 Crear la entrada `.desktop` y verificar que la aplicación aparece en el menú de GNOME y abre la ventana
- [x] 9.3 Crear `uninstall.sh`, y verificar que detiene y elimina la unidad y la entrada de menú, y que conserva la base de datos salvo confirmación
- [x] 9.4 Documentar instalación, uso y solución de problemas en `~/Documents/Documentation` y actualizar el README, y verificar que los comandos documentados funcionan tal como están escritos

## 10. Integración

- [x] 10.1 Probar el flujo completo de catch-up: crear un cron de cada minuto, detener el daemon, esperar tres minutos, arrancarlo y verificar que aparece exactamente una ejecución marcada como recuperada
- [x] 10.2 Probar el flujo completo con la ventana cerrada: crear un cron, cerrar la ventana, esperar la ejecución y verificar notificación, historial y chat
- [x] 10.3 Revisar que ningún código específico de Linux queda fuera de `packages/platform/linux`, y verificar con una búsqueda de `systemctl`, `notify-send` y `osascript` en el resto de paquetes

## Workflow follow-up

- Archivar el cambio con `openspec archive add-ai-cron-scheduler` cuando la implementación esté verificada.
- Confirmar el nombre definitivo del binario y la licencia antes de publicar la primera release.
