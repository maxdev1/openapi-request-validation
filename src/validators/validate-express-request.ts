import {
  compactObject,
  parseJsonBody,
  validateNormalizedRequest,
  type ValidationFunction,
  type ValidationRuntimeOptions,
} from "./validate.js";
import {createValidationError} from "./error.js";
import {normalizeHeaders, normalizeRecord} from "./normalization.js";

export type ExpressRequestLike = {
  headers?: Record<string, unknown> | undefined
  query?: Record<string, unknown> | undefined
  params?: Record<string, unknown> | undefined
  body?: unknown
}

export type ExpressNextLike = (error?: unknown) => unknown

export type ExpressHandlerLike<
  TRequest extends ExpressRequestLike = ExpressRequestLike,
  TResponse = unknown,
  TNext extends ExpressNextLike = ExpressNextLike,
  TResult = unknown,
> = (req: TRequest, res: TResponse, next: TNext) => TResult

/**
 * Validates an Express request against a generated validator.
 *
 * Express already exposes request data in a shape that is close to the
 * normalized validator payload, so this helper mostly handles body parsing,
 * header normalization, and consistent AJV error reporting.
 */
export function validateExpressRequest(
  validationFunction: ValidationFunction,
  request: ExpressRequestLike,
  options: ValidationRuntimeOptions = {},
): void {
  let body: unknown
  try {
    body = parseJsonBody(request.body)
  } catch {
    throw createValidationError(options, "body must be valid JSON")
  }

  const payload = compactObject({
    headers: normalizeHeaders(request.headers),
    query: normalizeRecord(request.query),
    path: normalizeRecord(request.params),
    body,
  })

  validateNormalizedRequest(validationFunction, payload, options)
}

/**
 * Wraps an Express handler with request validation and forwards validation
 * failures to `next(error)`.
 *
 * This mirrors the convenience of `withValidation` for lambda-api while
 * matching Express's standard error propagation flow.
 */
export function withExpressValidation<
  TRequest extends ExpressRequestLike,
  TResponse,
  TNext extends ExpressNextLike,
  TResult,
>(
  validationFunction: ValidationFunction,
  handler: ExpressHandlerLike<TRequest, TResponse, TNext, TResult>,
  options: ValidationRuntimeOptions = {},
) {
  return (req: TRequest, res: TResponse, next: TNext): TResult | ReturnType<TNext> => {
    try {
      validateExpressRequest(validationFunction, req, options)
      return handler(req, res, next)
    } catch (error) {
      return next(error) as ReturnType<TNext>
    }
  }
}
