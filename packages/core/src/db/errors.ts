import { t } from "../i18n.js";

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
  constructor(message: string = t("db.notFound")) {
    super(message);
    this.name = "NotFoundError";
  }
}
