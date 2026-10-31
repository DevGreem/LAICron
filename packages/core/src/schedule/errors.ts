/** Field of a schedule definition that caused a validation failure. */
export type ScheduleField = "scheduleKind" | "scheduleExpr" | "timezone";

/**
 * Error raised when a schedule definition cannot be interpreted.
 * The `field` property tells the caller which input must be corrected.
 */
export class ScheduleError extends Error {
  readonly field: ScheduleField;

  constructor(field: ScheduleField, message: string) {
    super(message);
    this.name = "ScheduleError";
    this.field = field;
  }
}
