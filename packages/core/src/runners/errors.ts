/**
 * Raised by callers that want to signal a timed-out run as an exception.
 * The built-in runners report timeouts through `RunResult.status` instead.
 */
export class TimeoutError extends Error {
  constructor(message = "operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}
