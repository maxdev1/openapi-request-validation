import type {OpenAPIV3} from "openapi-types"
import {parse as parseYaml} from "yaml"
import {isOpenApiV3} from "../../src/generator/is-open-api-v3.js"

const SYNTHETIC_SPEC_BASE_URL = "https://openapi-request-validation.invalid/spec.yaml"

export type LoadOpenApiV3SpecOptions = {
  spec: string | OpenAPIV3.Document
  baseUrl?: string
}

function parseOpenApiSpec(spec: string | OpenAPIV3.Document): OpenAPIV3.Document | unknown {
  if (typeof spec !== "string") {
    return spec
  }

  try {
    return JSON.parse(spec)
  } catch {
    return parseYaml(spec)
  }
}

function findExternalRefs(value: unknown, refs: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return refs
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      findExternalRefs(entry, refs)
    }

    return refs
  }

  if (
    "$ref" in value &&
    typeof (value as {$ref?: unknown}).$ref === "string" &&
    !(value as {$ref: string}).$ref.startsWith("#/")
  ) {
    refs.push((value as {$ref: string}).$ref)
  }

  for (const entry of Object.values(value)) {
    findExternalRefs(entry, refs)
  }

  return refs
}

function isAbsoluteUrlRef(ref: string): boolean {
  try {
    const url = new URL(ref)
    return url.protocol.length > 0
  } catch {
    return false
  }
}

function resolveLocalRef<T>(doc: unknown, ref: string): T {
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

type RefResolutionContext = {
  document: unknown
  documentId: string
  baseUrl?: string
}

type RefResolutionCache = {
  documents: Map<string, Promise<unknown>>
  refs: Map<string, Promise<unknown>>
}

function splitRef(ref: string): {documentUrl: string; fragment: string} {
  const hashIndex = ref.indexOf("#")
  if (hashIndex === -1) {
    return {documentUrl: ref, fragment: ""}
  }

  return {
    documentUrl: ref.slice(0, hashIndex),
    fragment: ref.slice(hashIndex),
  }
}

async function loadExternalDocument(
  documentUrl: string,
  cache: RefResolutionCache,
): Promise<unknown> {
  const cachedDocument = cache.documents.get(documentUrl)
  if (cachedDocument) {
    return cachedDocument
  }

  const documentPromise = (async () => {
    const response = await fetch(documentUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch external $ref: ${documentUrl} (${response.status})`)
    }

    return parseOpenApiSpec(await response.text())
  })()

  cache.documents.set(documentUrl, documentPromise)
  return documentPromise
}

async function materializeValue(
  value: unknown,
  context: RefResolutionContext,
  cache: RefResolutionCache,
): Promise<unknown> {
  if (!value || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => materializeValue(entry, context, cache)))
  }

  const ref = "$ref" in value && typeof (value as {$ref?: unknown}).$ref === "string"
    ? (value as {$ref: string}).$ref
    : null

  if (ref) {
    const refKey = ref.startsWith("#/")
      ? `${context.documentId}${ref}`
      : context.baseUrl
        ? new URL(ref, context.baseUrl).href
        : ref
    const cachedRef = cache.refs.get(refKey)
    if (cachedRef) {
      return cachedRef
    }

    const refPromise = (async () => {
      if (ref.startsWith("#/")) {
        return materializeValue(resolveLocalRef(context.document, ref), context, cache)
      }

      const resolvedUrl = context.baseUrl ? new URL(ref, context.baseUrl).href : ref
      if (!isAbsoluteUrlRef(resolvedUrl)) {
        throw new Error(`External $ref requires a baseUrl or a pre-bundled spec: ${ref}`)
      }

      const {documentUrl, fragment} = splitRef(resolvedUrl)
      const externalDocument = await loadExternalDocument(documentUrl, cache)
      const nextContext: RefResolutionContext = {
        document: externalDocument,
        documentId: documentUrl,
        baseUrl: documentUrl,
      }
      const target = fragment ? resolveLocalRef(externalDocument, fragment) : externalDocument
      return materializeValue(target, nextContext, cache)
    })()

    cache.refs.set(refKey, refPromise)
    return refPromise
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, entry]) => [key, await materializeValue(entry, context, cache)]),
  )

  return Object.fromEntries(entries)
}

async function inlineExternalRefs(
  spec: OpenAPIV3.Document,
  baseUrl?: string,
): Promise<OpenAPIV3.Document> {
  const cache: RefResolutionCache = {
    documents: new Map(),
    refs: new Map(),
  }

  return (await materializeValue(
    spec,
    baseUrl
      ? {
        document: spec,
        documentId: baseUrl,
        baseUrl,
      }
      : {
        document: spec,
        documentId: SYNTHETIC_SPEC_BASE_URL,
      },
    cache,
  )) as OpenAPIV3.Document
}

export async function loadOpenApiV3Spec(
  options: LoadOpenApiV3SpecOptions,
): Promise<OpenAPIV3.Document> {
  const parsedSpec = parseOpenApiSpec(options.spec)
  if (!isOpenApiV3(parsedSpec)) {
    throw new Error("Only OpenAPI v3 specs are supported")
  }

  const externalRefs = findExternalRefs(parsedSpec)
  const canResolveRelativeRefs = options.baseUrl ? isAbsoluteUrlRef(options.baseUrl) : false
  const nonAbsoluteExternalRef = externalRefs.find((ref) => !isAbsoluteUrlRef(ref))

  if (nonAbsoluteExternalRef && !canResolveRelativeRefs) {
    throw new Error(`External $ref requires a baseUrl or a pre-bundled spec: ${nonAbsoluteExternalRef}`)
  }

  if (externalRefs.length === 0) {
    return parsedSpec
  }

  return inlineExternalRefs(parsedSpec, options.baseUrl)
}
