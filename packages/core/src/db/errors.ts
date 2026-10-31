/** Validation failure for a persisted entity. `field` names the offending input field. */
export class ValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/** Raised when an entity is expected to exist but is not present in the database. */
export class NotFoundError extends Error {
  constructor(message = "Recurso no encontrado.") {
    super(message);
    this.name = "NotFoundError";
  }
}
