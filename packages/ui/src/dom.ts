/**
 * Minimal DOM helpers. Everything user-provided goes through `textContent`
 * (the `text` option or text children), never through `innerHTML`.
 */

export type Child = Node | string | number | null | undefined | false;

export type EventListeners = Record<string, (event: Event) => void>;

export interface ElementOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  dataset?: Record<string, string>;
  on?: EventListeners;
  value?: string;
  checked?: boolean;
}

function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    if (typeof child === "string" || typeof child === "number") {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child);
    }
  }
}

/** Creates an element with classes, attributes, listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (options.class !== undefined) {
    element.className = options.class;
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  }

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    element.setAttribute(name, value === true ? "" : String(value));
  }

  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    element.dataset[name] = value;
  }

  for (const [type, listener] of Object.entries(options.on ?? {})) {
    element.addEventListener(type, listener);
  }

  appendChildren(element, children);

  if (
    options.value !== undefined &&
    (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement)
  ) {
    element.value = options.value;
  }
  if (options.checked !== undefined && element instanceof HTMLInputElement) {
    element.checked = options.checked;
  }

  return element;
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Creates a `<select>` with the given options and initial value. */
export function selectControl(
  id: string,
  name: string,
  options: SelectOption[],
  value: string,
): HTMLSelectElement {
  const element = h(
    "select",
    { attrs: { id, name } },
    ...options.map((option) => h("option", { text: option.label, attrs: { value: option.value } })),
  );
  element.value = value;
  return element;
}

export interface FieldOptions {
  hint?: string;
  full?: boolean;
}

/** Label + control pair; the error slot is added by {@link formField}. */
export function field(
  labelText: string,
  control: HTMLElement,
  options: FieldOptions = {},
): HTMLElement {
  const label = h("label", { class: "field-label", text: labelText });
  if (control.id.length > 0) {
    label.htmlFor = control.id;
  }

  const wrapper = h(
    "div",
    { class: options.full === true ? "field field-full" : "field" },
    label,
    control,
  );
  if (options.hint !== undefined) {
    wrapper.appendChild(h("p", { class: "field-hint", text: options.hint }));
  }
  return wrapper;
}

/** Error slot keyed by the API field name (`error.field`). */
export function errorSlot(fieldName: string): HTMLElement {
  return h("p", {
    class: "field-error",
    attrs: { hidden: true, "data-error-for": fieldName },
  });
}

export interface FormFieldOptions extends FieldOptions {
  field: string;
}

/** Label + control + inline error slot. */
export function formField(
  labelText: string,
  control: HTMLElement,
  options: FormFieldOptions,
): HTMLElement {
  const wrapper = field(labelText, control, options);
  wrapper.appendChild(errorSlot(options.field));
  return wrapper;
}

export interface CheckboxFieldOptions {
  field?: string;
  hint?: string;
}

/** Checkbox with its label wrapped around the input. */
export function checkboxField(
  labelText: string,
  control: HTMLInputElement,
  options: CheckboxFieldOptions = {},
): HTMLElement {
  const wrapper = h(
    "div",
    { class: "field field-checkbox" },
    h("label", { class: "checkbox" }, control, h("span", { text: labelText })),
  );
  if (options.hint !== undefined) {
    wrapper.appendChild(h("p", { class: "field-hint", text: options.hint }));
  }
  if (options.field !== undefined) {
    wrapper.appendChild(errorSlot(options.field));
  }
  return wrapper;
}

export interface ButtonOptions {
  variant?: "primary" | "danger" | "ghost";
  small?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}

/** Creates a button; listeners are optional for submit buttons. */
export function button(
  text: string,
  onClick?: (event: MouseEvent) => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const classes = ["btn"];
  if (options.variant !== undefined) {
    classes.push(`btn-${options.variant}`);
  }
  if (options.small === true) {
    classes.push("btn-sm");
  }

  const element = h("button", {
    class: classes.join(" "),
    text,
    attrs: {
      type: options.type ?? "button",
      ...(options.title !== undefined ? { title: options.title } : {}),
    },
    on:
      onClick === undefined
        ? {}
        : {
            click: (event: Event): void => {
              onClick(event as MouseEvent);
            },
          },
  });
  element.disabled = options.disabled ?? false;
  return element;
}

/** Sets (or clears, with `null`) the inline error of one field. */
export function setFieldError(
  container: ParentNode,
  fieldName: string,
  message: string | null,
): void {
  const slot = container.querySelector<HTMLElement>(`[data-error-for="${fieldName}"]`);
  if (slot === null) {
    return;
  }
  slot.textContent = message ?? "";
  slot.hidden = message === null;
}

/** Clears every inline error slot inside `container`. */
export function clearFieldErrors(container: ParentNode): void {
  container.querySelectorAll<HTMLElement>("[data-error-for]").forEach((slot) => {
    slot.textContent = "";
    slot.hidden = true;
  });
}
