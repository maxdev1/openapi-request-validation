import {
  compactObject, parseJsonBody, validateNormalizedRequest,
  type ValidationFunction,
  type ValidationRuntimeOptions
} from "./validate.js";
import {createValidationError} from "./error.js";
import {normalizeHeaders, normalizeQuery, normalizeRecord} from "./normalization.js";

/**
 * Validates an API Gateway event against a generated validator.
 *
 * API Gateway spreads request data across headers, query maps, path
 * parameters, and a raw body string. This helper exists to normalize that
 * shape into the `{headers, query, path, body}` object expected by generated
 * validators.
 */
export function validateApiGatewayEvent(
  validationFunction: ValidationFunction,
  event: ApiGatewayEventLike,
  options: ValidationRuntimeOptions = {},
): void {
  let body: unknown
  try {
    body = parseJsonBody(event.body, event.isBase64Encoded === true)
  } catch {
    throw createValidationError(options, "body must be valid JSON")
  }

  const payload = compactObject({
    headers: normalizeHeaders(event.headers, event.multiValueHeaders),
    query: normalizeQuery(event.queryStringParameters, event.multiValueQueryStringParameters),
    path: normalizeRecord(event.pathParameters),
    body,
  })

  validateNormalizedRequest(validationFunction, payload, options)
}

/**
 * Minimal API Gateway event shape needed for validation.
 *
 * The helper uses a structural type so consumers do not need to install the
 * full AWS Lambda type package just to validate an event.
 */
export type ApiGatewayEventLike = {
  headers?: Record<string, string | undefined> | null
  multiValueHeaders?: Record<string, string[] | undefined> | null
  queryStringParameters?: Record<string, string | undefined> | null
  multiValueQueryStringParameters?: Record<string, string[] | undefined> | null
  pathParameters?: Record<string, string | undefined> | null
  body?: string | null
  isBase64Encoded?: boolean
}

export type ApiGatewayProxyEventLike = ApiGatewayEventLike

export const validateApiGatewayProxyEvent = validateApiGatewayEvent
