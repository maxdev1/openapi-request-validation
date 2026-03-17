import type {ErrorObject} from "ajv";
import type {ValidationRuntimeOptions} from "./validate.js";

/**
 * Default error thrown by the runtime validators.
 */
export class RequestValidationError extends Error {
  readonly status = 400
  readonly statusCode = 400
  readonly errors: ErrorObject[]

  constructor(message: string, errors: ErrorObject[] = []) {
    super(message)
    this.name = "RequestValidationError"
    this.errors = errors
  }
}

/**
 * Builds the throwable used for validation failures.
 */
export function createValidationError(
  options: ValidationRuntimeOptions,
  message: string,
  errors: ErrorObject[] = [],
): Error {
  return options.createError?.(message, errors) ?? new RequestValidationError(message, errors)
}

/**
 * Converts raw AJV errors into one compact request-focused message.
 */
export function formatAjvErrors(errors: ErrorObject[]): string {
  return errors
    .map((error) => `${error.instancePath || "request"} ${error.message ?? "is invalid"}`)
    .join(", ")
}
