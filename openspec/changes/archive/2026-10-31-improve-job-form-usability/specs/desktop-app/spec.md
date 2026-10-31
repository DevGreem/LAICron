# Spec Delta

## ADDED Requirements

### Requirement: Catálogo de opciones del ejecutor de IA

El sistema DEBE exponer a la ventana un catálogo con los modelos disponibles, las variantes de cada
modelo y los agentes que pueden ejecutarse como primarios. El catálogo NO DEBE incluir los prompts
internos ni la configuración privada de los agentes.

#### Scenario: Catálogo disponible

- **WHEN** `opencode` está instalado y la ventana abre el formulario
- **THEN** el formulario ofrece la lista de modelos con su nombre legible y la lista de agentes primarios

#### Scenario: Variante de modelo

- **WHEN** el usuario elige un modelo con variantes y selecciona una distinta de la predeterminada
- **THEN** el cron guarda el modelo como `proveedor/modelo#variante`

#### Scenario: Subagente excluido

- **WHEN** un agente de `opencode` está marcado como subagente
- **THEN** no aparece en la lista de agentes del formulario

### Requirement: Selección asistida en el formulario

El formulario DEBE presentar el modelo, la variante y el agente como listas seleccionables, y DEBE
ofrecer una opción de entrada manual para cada uno.

#### Scenario: Modelo y variante

- **WHEN** el usuario elige un modelo y una variante de la lista
- **THEN** el cron se guarda con el valor compuesto y la ejecución usa ese modelo y esa variante

#### Scenario: Entrada manual

- **WHEN** el usuario elige «Personalizado» en modelo, variante o agente
- **THEN** aparece un campo de texto y se guarda exactamente el valor escrito

#### Scenario: Recargar catálogo

- **WHEN** el usuario pulsa «Recargar opciones»
- **THEN** el sistema vuelve a leer el catálogo y actualiza las listas sin reiniciar el daemon

### Requirement: Degradación sin catálogo

Si `opencode` no está disponible o el catálogo no se puede leer, el formulario DEBE seguir
permitiendo crear y editar crons con entrada manual y DEBE avisar de que no pudo cargar las
opciones.

#### Scenario: opencode ausente

- **WHEN** el binario `opencode` no existe o el catálogo falla
- **THEN** el formulario muestra los campos de texto, un aviso y permite guardar el cron

### Requirement: Selección de zona horaria

El formulario DEBE ofrecer una lista de zonas horarias IANA que incluya `UTC` y la zona del equipo,
y DEBE mostrar la hora actual y el desfase de la zona elegida.

#### Scenario: Lista de zonas

- **WHEN** el usuario abre el formulario
- **THEN** el campo de zona horaria ofrece la lista y preselecciona la zona del equipo

#### Scenario: UTC

- **WHEN** el usuario elige `UTC`
- **THEN** el cron guarda `UTC` como zona horaria

#### Scenario: Desfase visible

- **WHEN** el usuario cambia la zona horaria
- **THEN** el formulario muestra la hora actual de esa zona y su desfase respecto a UTC

### Requirement: Construcción de cron por campos

El formulario DEBE permitir construir una expresión cron de cinco campos mediante controles
separados, con presets y una vista previa en lenguaje natural, y DEBE mantener un modo avanzado
para editar la expresión cruda.

#### Scenario: Campos separados

- **WHEN** el usuario pone minuto `0`, hora `9`, cualquier día y mes, y de lunes a viernes
- **THEN** el cron guarda la expresión `0 9 * * 1-5`

#### Scenario: Preset

- **WHEN** el usuario elige el preset «cada día a las 09:00»
- **THEN** los cinco campos y la vista previa se actualizan a esa programación

#### Scenario: Vista previa

- **WHEN** el usuario cambia cualquiera de los cinco campos
- **THEN** el formulario muestra una frase que describe cuándo se ejecutará el cron

#### Scenario: Edición de un cron existente

- **WHEN** el usuario edita un cron cuya expresión se puede dividir en cinco campos
- **THEN** los controles muestran esos valores y la vista previa corresponde a la expresión

#### Scenario: Expresión no interpretable

- **WHEN** la expresión de un cron existente no se puede dividir en cinco campos
- **THEN** el formulario abre el modo avanzado con el texto original y avisa de que debe revisarlo
