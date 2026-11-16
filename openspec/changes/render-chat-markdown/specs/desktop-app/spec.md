# Spec Delta

## ADDED Requirements

### Requirement: Renderizado de Markdown del asistente

El chat DEBE renderizar el Markdown de los mensajes del asistente en crons de `opencode`, con
títulos, énfasis, código inline, bloques de código, listas, citas, enlaces y tablas simples. Los
mensajes del usuario y la salida de los crons `shell` NO DEBEN renderizarse como Markdown.

#### Scenario: Mensaje con formato

- **WHEN** el asistente devuelve `**importante**` y una lista
- **THEN** el chat muestra el texto en negrita y la lista con viñetas

#### Scenario: Bloque de código

- **WHEN** el asistente devuelve un bloque con ```` ```ts ````
- **THEN** el chat muestra un bloque de código con el lenguaje y un botón para copiarlo

#### Scenario: Salida de shell

- **WHEN** el cron usa el runner `shell` y su salida contiene `#` o `*`
- **THEN** el chat la muestra como texto preformateado, sin interpretarla

#### Scenario: Prompt del usuario

- **WHEN** el usuario escribió un prompt con Markdown
- **THEN** el chat lo muestra como texto, sin cambiar su formato

### Requirement: Seguridad del renderizado

El renderizado NO DEBE ejecutar HTML del mensaje. El HTML crudo DEBE mostrarse como texto y los
enlaces con esquemas peligrosos NO DEBEN convertirse en enlaces.

#### Scenario: HTML crudo

- **WHEN** el mensaje contiene `<script>alert(1)</script>` o `<img onerror=...>`
- **THEN** el chat muestra el texto literal y no ejecuta nada

#### Scenario: Enlace peligroso

- **WHEN** el mensaje contiene `[x](javascript:alert(1))`
- **THEN** el chat no crea un enlace ejecutable

#### Scenario: Enlace externo

- **WHEN** el mensaje contiene `[docs](https://example.com)`
- **THEN** el chat crea un enlace que se abre en otra pestaña con `rel="noopener noreferrer"`
