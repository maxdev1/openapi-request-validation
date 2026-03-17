import type {OpenAPIV3} from "openapi-types"
import {HTTP_METHODS} from "../common/http-methods.js"
import {toPascalIdentifier} from "./pascal-identifier.js"
import {rewriteOpenApiDiscriminators} from "./rewrite-open-api-discriminators.js"

type ParameterLocation = "query" | "path" | "header"

export type ValidatorExports = Record<string, string>

type ParameterGroupSchema = {
  schema: OpenAPIV3.SchemaObject
  required: boolean
}

type RequestBodySchema = {
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | null
  required: boolean
}

type RequestInputParts = {
  query?: ParameterGroupSchema
  path?: ParameterGroupSchema
  headers?: ParameterGroupSchema
  body?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
  required: Array<"query" | "path" | "headers" | "body">
}

type ParameterSchemaGroup = {
  properties: Record<string, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  required: string[]
  additionalProperties: boolean
}

/**
 * Makes generated validator export names unique.
 *
 * OpenAPI specs occasionally reuse `operationId`s; this helper prevents those
 * collisions from overwriting earlier validators in the generated module.
 */
export function createUniqueName(candidate: string, seen: Map<string, number>): string {
  let count = seen.get(candidate) ?? 0
  let uniqueName = count === 0 ? candidate : `${candidate}${count + 1}`

  while (seen.has(uniqueName)) {
    count += 1
    uniqueName = `${candidate}${count + 1}`
  }

  seen.set(candidate, count + 1)
  seen.set(uniqueName, 1)
  return uniqueName
}

/**
 * Resolves a local `$ref` inside the bundled OpenAPI document.
 *
 * The generator follows local references while building request-only schemas
 * for the validator output.
 */
export function resolveLocalRef<T>(doc: unknown, ref: string): T {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local refs are supported here: ${ref}`)
  }

  const resolved = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], doc)

  if (resolved === undefined) {
    throw new Error(`Could not resolve ref: ${ref}`)
  }

  return resolved as T
}

function resolveMaybeRef<T extends object>(
  doc: OpenAPIV3.Document,
  value: T | OpenAPIV3.ReferenceObject,
): T {
  return "$ref" in value ? resolveLocalRef<T>(doc, value.$ref) : value
}

function resolvePathItem(
  doc: OpenAPIV3.Document,
  pathItem: OpenAPIV3.PathItemObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.PathItemObject {
  return resolveMaybeRef(doc, pathItem)
}

function resolveRequestBody(
  doc: OpenAPIV3.Document,
  requestBody: OpenAPIV3.RequestBodyObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.RequestBodyObject {
  return resolveMaybeRef(doc, requestBody)
}

function resolveParameter(
  doc: OpenAPIV3.Document,
  parameter: OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.ParameterObject {
  return resolveMaybeRef(doc, parameter)
}

function getJsonMediaSchema(
  content?: OpenAPIV3.RequestBodyObject["content"],
): OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | null {
  if (!content) return null

  const direct = content["application/json"]?.schema
  if (direct) return direct

  for (const [mediaType, media] of Object.entries(content)) {
    if ((mediaType === "application/json" || mediaType.endsWith("+json")) && media?.schema) {
      return media.schema
    }
  }

  return null
}

function getFirstContentSchema(
  content?: OpenAPIV3.RequestBodyObject["content"],
): OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | null {
  if (!content) return null

  for (const media of Object.values(content)) {
    if (media?.schema) {
      return media.schema
    }
  }

  return null
}

function extractJsonRequestBodySchema(
  doc: OpenAPIV3.Document,
  requestBody?: OpenAPIV3.RequestBodyObject | OpenAPIV3.ReferenceObject,
): RequestBodySchema {
  if (!requestBody) {
    return {schema: null, required: false}
  }

  const resolved = resolveRequestBody(doc, requestBody)
  return {
    schema: getJsonMediaSchema(resolved.content),
    required: resolved.required === true,
  }
}

function extractParameterSchema(
  doc: OpenAPIV3.Document,
  parameter: OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | null {
  const resolved = resolveParameter(doc, parameter)

  if (resolved.schema) {
    return "$ref" in parameter ? {$ref: `${parameter.$ref}/schema`} : resolved.schema
  }

  return getFirstContentSchema(resolved.content)
}

function normalizeParameterName(location: ParameterLocation, name: string): string {
  return location === "header" ? name.toLowerCase() : name
}

function createParameterSchemaGroups(): Record<ParameterLocation, ParameterSchemaGroup> {
  return {
    query: {properties: {}, required: [], additionalProperties: false},
    path: {properties: {}, required: [], additionalProperties: false},
    header: {properties: {}, required: [], additionalProperties: true},
  }
}

function mergeParameters(
  spec: OpenAPIV3.Document,
  pathItem: OpenAPIV3.PathItemObject,
  operation: OpenAPIV3.OperationObject,
): Array<OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject> {
  const merged = new Map<string, OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject>()

  for (const parameter of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const resolved = resolveParameter(spec, parameter)

    if (resolved.in === "cookie") {
      console.warn(`Skipping cookie parameter "${resolved.name}"`)
      continue
    }

    const location = resolved.in as ParameterLocation
    const normalizedName = normalizeParameterName(location, resolved.name)
    merged.set(`${location}:${normalizedName}`, parameter)
  }

  return [...merged.values()]
}

function buildParameterInputSchemas(
  doc: OpenAPIV3.Document,
  parameters: Array<OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject>,
): Omit<RequestInputParts, "body" | "required"> {
  const groups = createParameterSchemaGroups()

  for (const parameter of parameters) {
    const resolved = resolveParameter(doc, parameter)

    if (resolved.in === "cookie") {
      continue
    }

    const location = resolved.in as ParameterLocation
    const group = groups[location]
    if (!group) {
      continue
    }

    const schema = extractParameterSchema(doc, parameter)
    if (!schema) {
      console.warn(`Skipping parameter without schema/content support: ${resolved.name}`)
      continue
    }

    const normalizedName = normalizeParameterName(location, resolved.name)
    group.properties[normalizedName] = schema

    if (resolved.required || location === "path") {
      group.required.push(normalizedName)
    }
  }

  const result: Omit<RequestInputParts, "body" | "required"> = {}

  if (Object.keys(groups.query.properties).length > 0) {
    result.query = {
      schema: {
        type: "object",
        properties: groups.query.properties,
        additionalProperties: groups.query.additionalProperties,
        ...(groups.query.required.length > 0 ? {required: groups.query.required} : {}),
      },
      required: groups.query.required.length > 0,
    }
  }

  if (Object.keys(groups.path.properties).length > 0) {
    result.path = {
      schema: {
        type: "object",
        properties: groups.path.properties,
        additionalProperties: groups.path.additionalProperties,
        ...(groups.path.required.length > 0 ? {required: groups.path.required} : {}),
      },
      required: groups.path.required.length > 0,
    }
  }

  if (Object.keys(groups.header.properties).length > 0) {
    result.headers = {
      schema: {
        type: "object",
        properties: groups.header.properties,
        additionalProperties: groups.header.additionalProperties,
        ...(groups.header.required.length > 0 ? {required: groups.header.required} : {}),
      },
      required: groups.header.required.length > 0,
    }
  }

  return result
}

function buildOperationRequestParts(
  spec: OpenAPIV3.Document,
  pathItem: OpenAPIV3.PathItemObject,
  operation: OpenAPIV3.OperationObject,
): RequestInputParts {
  const parameterSchemas = buildParameterInputSchemas(spec, mergeParameters(spec, pathItem, operation))
  const bodySchema = extractJsonRequestBodySchema(spec, operation.requestBody)

  const required: RequestInputParts["required"] = []

  if (parameterSchemas.query?.required) {
    required.push("query")
  }

  if (parameterSchemas.path?.required) {
    required.push("path")
  }

  if (parameterSchemas.headers?.required) {
    required.push("headers")
  }

  if (bodySchema.required && bodySchema.schema) {
    required.push("body")
  }

  return {
    ...parameterSchemas,
    ...(bodySchema.schema ? {body: bodySchema.schema} : {}),
    required,
  }
}

function buildOperationRequestSchema(
  spec: OpenAPIV3.Document,
  pathItem: OpenAPIV3.PathItemObject,
  operation: OpenAPIV3.OperationObject,
): OpenAPIV3.SchemaObject | null {
  const parts = buildOperationRequestParts(spec, pathItem, operation)

  const properties: Record<string, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject> = {}

  if (parts.query) {
    properties.query = parts.query.schema
  }

  if (parts.path) {
    properties.path = parts.path.schema
  }

  if (parts.headers) {
    properties.headers = parts.headers.schema
  }

  if (parts.body) {
    properties.body = parts.body
  }

  if (Object.keys(properties).length === 0) {
    return null
  }

  return {
    type: "object",
    properties,
    additionalProperties: false,
    ...(parts.required.length > 0 ? {required: parts.required} : {}),
  }
}

function ensureComponentsSchemas(
  spec: OpenAPIV3.Document,
): NonNullable<OpenAPIV3.ComponentsObject["schemas"]> {
  spec.components ??= {}
  spec.components.schemas ??= {}
  return spec.components.schemas
}

function registerRequestSchemasAndCollectValidators(spec: OpenAPIV3.Document): ValidatorExports {
  const componentSchemas = ensureComponentsSchemas(spec)
  const validators: ValidatorExports = {}
  const seenOperationNames = new Map<string, number>()
  const seenSchemaNames = new Map<string, number>(
    Object.keys(componentSchemas).map((schemaName) => [schemaName, 1]),
  )

  for (const [pathKey, rawPathItem] of Object.entries(spec.paths ?? {})) {
    const pathItem = resolvePathItem(
      spec,
      rawPathItem as OpenAPIV3.PathItemObject | OpenAPIV3.ReferenceObject,
    )

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!operation) {
        continue
      }

      const baseName = createUniqueName(
        toPascalIdentifier(operation.operationId ?? `${method} ${pathKey}`),
        seenOperationNames,
      )

      const requestSchema = buildOperationRequestSchema(spec, pathItem, operation)
      if (!requestSchema) {
        continue
      }

      const schemaName = createUniqueName(`${baseName}Request`, seenSchemaNames)
      componentSchemas[schemaName] = requestSchema
      validators[`validate${baseName}Request`] = `Spec#/components/schemas/${schemaName}`
    }
  }

  return validators
}

/**
 * Clones the OpenAPI document, injects request-only component schemas, and
 * returns the validator export map used by both standalone generation and
 * other in-memory compilation flows.
 */
export function prepareValidatorArtifacts(
  spec: OpenAPIV3.Document,
): {
  spec: OpenAPIV3.Document
  validators: ValidatorExports
} {
  const specForValidation = structuredClone(spec)
  rewriteOpenApiDiscriminators(specForValidation)
  const validators = registerRequestSchemasAndCollectValidators(specForValidation)

  return {
    spec: specForValidation,
    validators,
  }
}
