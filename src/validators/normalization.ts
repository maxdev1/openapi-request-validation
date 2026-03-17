/**
 * Merges API Gateway single-value and multi-value query maps into one object.
 */
export function normalizeQuery(query: unknown, multiValueQuery?: unknown): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) {
        result[key] = value
      }
    }
  }

  if (multiValueQuery && typeof multiValueQuery === "object") {
    for (const [key, value] of Object.entries(multiValueQuery)) {
      if (!Array.isArray(value) || value.length === 0) {
        continue
      }

      result[key] = value.length === 1 ? value[0] : value
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Normalizes headers into the shape expected by generated validators.
 */
export function normalizeHeaders(
  headers: unknown,
  multiValueHeaders?: unknown,
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}

  for (const source of [headers, multiValueHeaders]) {
    if (!source || typeof source !== "object") {
      continue
    }

    for (const [rawKey, rawValue] of Object.entries(source)) {
      if (!rawKey || rawValue == null) {
        continue
      }

      const key = rawKey.toLowerCase()
      if (Array.isArray(rawValue)) {
        if (rawValue.length === 1) {
          result[key] = rawValue[0]
        } else if (rawValue.length > 1) {
          result[key] = rawValue
        }
      } else {
        result[key] = rawValue
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Normalizes plain object bags such as path params or lambda-api query data.
 */
export function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry != null) {
      result[key] = entry
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}