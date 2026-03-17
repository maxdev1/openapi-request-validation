import {
  compactObject,
  parseJsonBody,
  validateNormalizedRequest,
  type ValidationFunction,
  type ValidationRuntimeOptions
} from "./validate.js";
import {createValidationError} from "./error.js";
import {normalizeHeaders, normalizeRecord} from "./normalization.js";

export type LambdaApiRequestLike = {
  headers?: Record<string, unknown> | undefined
  query?: Record<string, unknown> | undefined
  params?: Record<string, unknown> | undefined
  body?: unknown
}

export type LambdaApiHandlerLike<
  TRequest extends LambdaApiRequestLike = LambdaApiRequestLike,
  TResponse = unknown,
  TResult = unknown,
> = (req: TRequest, res: TResponse) => TResult

/**
 * Validates a lambda-api request against a generated validator.
 *
 * The helper exists so lambda-api's native request object can be translated
 * into the same normalized `{headers, query, path, body}` shape used by the
 * generated validators and the API Gateway validator.
 */
export function validateLambdaApiRequest(
  validationFunction: ValidationFunction,
  request: LambdaApiRequestLike,
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
 * Wraps a lambda-api handler with request validation.
 *
 * This keeps validation at the route boundary so downstream handler code only
 * runs after the request has already passed schema validation.
 */
export function withLambdaApiValidation<
  TRequest extends LambdaApiRequestLike,
  TResponse,
  TResult,
>(
  validationFunction: ValidationFunction,
  handler: LambdaApiHandlerLike<TRequest, TResponse, TResult>,
  options: ValidationRuntimeOptions = {},
) {
  return (req: TRequest, res: TResponse): TResult => {
    validateLambdaApiRequest(validationFunction, req, options)
    return handler(req, res)
  }
}
