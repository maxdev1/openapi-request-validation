import {Buffer} from "node:buffer"
import type {ErrorObject} from "ajv"
import {createValidationError, formatAjvErrors, RequestValidationError} from "./error.js";

export {RequestValidationError} from "./error.js";

/**
 * Contract implemented by AJV standalone validators. Generated validators return `true` for valid input and populate
 * `errors` with detailed AJV failures when validation does not pass.
 */
export type ValidationFunction = ((value: unknown) => boolean) & {
  errors?: ErrorObject[] | null
}

/**
 * Optional hooks for integrating validation with an application's own error model.
 */
export type ValidationRuntimeOptions = {
  createError?: (message: string, errors?: ErrorObject[]) => Error
}

/**
 * Removes undefined sections from the normalized payload.
 */
export function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

/**
 * Parses request bodies into JSON before validation.
 */
export function parseJsonBody(body: unknown, isBase64Encoded = false): unknown {
  if (body == null || body === "") {
    return undefined
  }

  if (typeof body !== "string") {
    return body
  }

  const rawBody = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body
  return JSON.parse(rawBody)
}

/**
 * Runs a normalized request payload through a generated validator.
 */
export function validateNormalizedRequest(
  validationFunction: ValidationFunction,
  payload: unknown,
  options: ValidationRuntimeOptions,
): void {
  if (validationFunction(payload)) {
    return
  }

  const errors = validationFunction.errors ?? []
  if (errors.length === 0) {
    throw createValidationError(options, "Request validation failed")
  }

  throw createValidationError(options, formatAjvErrors(errors), errors)
}
