import type {OpenAPIV3} from "openapi-types"
import {resolveLocalRef} from "./validator-artifacts.js"

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isReferenceObject(value: unknown): value is OpenAPIV3.ReferenceObject {
  return isObjectRecord(value) && typeof value.$ref === "string"
}

function extractStringLiteralValues(
  doc: OpenAPIV3.Document,
  schema: unknown,
): string[] {
  if (!isObjectRecord(schema)) {
    return []
  }

  const resolved = isReferenceObject(schema)
    ? resolveLocalRef<Record<string, unknown>>(doc, schema.$ref)
    : schema

  if (typeof resolved.const === "string") {
    return [resolved.const]
  }

  if (Array.isArray(resolved.enum) && resolved.enum.every((value) => typeof value === "string")) {
    return [...resolved.enum]
  }

  return []
}

function inferDiscriminatorValues(
  doc: OpenAPIV3.Document,
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  propertyName: string,
): string[] {
  const resolved = isReferenceObject(schema)
    ? resolveLocalRef<Record<string, unknown>>(doc, schema.$ref)
    : schema as Record<string, unknown>

  const properties = isObjectRecord(resolved.properties) ? resolved.properties : null
  const directValues = extractStringLiteralValues(doc, properties?.[propertyName])
  if (directValues.length > 0) {
    return directValues
  }

  if (!isReferenceObject(schema)) {
    return []
  }

  const segments = schema.$ref.split("/")
  const schemaName = segments.at(-1)
  return schemaName ? [schemaName] : []
}

type DiscriminatorBranch = {
  tagValues: string[]
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
}

function getDiscriminatorBranches(
  doc: OpenAPIV3.Document,
  unionMembers: Array<OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>,
  discriminator: OpenAPIV3.DiscriminatorObject,
): DiscriminatorBranch[] {
  const mappingEntries = Object.entries(discriminator.mapping ?? {})
  const branches: DiscriminatorBranch[] = []
  const seenTagValues = new Set<string>()

  for (const member of unionMembers) {
    const tagValues = new Set<string>()

    if (isReferenceObject(member)) {
      for (const [tagValue, mappedRef] of mappingEntries) {
        if (mappedRef === member.$ref) {
          tagValues.add(tagValue)
        }
      }
    }

    if (tagValues.size === 0) {
      for (const tagValue of inferDiscriminatorValues(doc, member, discriminator.propertyName)) {
        tagValues.add(tagValue)
      }
    }

    if (tagValues.size === 0) {
      return []
    }

    for (const tagValue of tagValues) {
      if (seenTagValues.has(tagValue)) {
        return []
      }

      seenTagValues.add(tagValue)
    }

    branches.push({
      tagValues: [...tagValues],
      schema: member,
    })
  }

  return branches
}

function createDiscriminatorMatcher(
  propertyName: string,
  tagValues: string[],
): Record<string, unknown> {
  return {
    type: "object",
    required: [propertyName],
    properties: {
      [propertyName]: tagValues.length === 1 ? {const: tagValues[0]} : {enum: tagValues},
    },
  }
}

function rewriteDiscriminatorSchema(
  doc: OpenAPIV3.Document,
  schema: Record<string, unknown>,
): void {
  const discriminator = schema.discriminator
  if (!isObjectRecord(discriminator) || typeof discriminator.propertyName !== "string") {
    return
  }

  const propertyName = discriminator.propertyName

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : null
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : null
  const unionMembers = oneOf ?? anyOf

  if (!unionMembers) {
    return
  }

  const branches = getDiscriminatorBranches(
    doc,
    unionMembers as Array<OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>,
    discriminator as unknown as OpenAPIV3.DiscriminatorObject,
  )

  if (branches.length === 0) {
    return
  }

  const existingAllOf = Array.isArray(schema.allOf) ? [...schema.allOf] : []
  const allowedTagValues = branches.flatMap((branch) => branch.tagValues)

  schema.allOf = [
    ...existingAllOf,
    createDiscriminatorMatcher(propertyName, allowedTagValues),
    ...branches.map((branch) => ({
      if: createDiscriminatorMatcher(propertyName, branch.tagValues),
      then: branch.schema,
    })),
  ] as Array<OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>

  delete schema.discriminator
  delete schema.oneOf
  delete schema.anyOf
}

export function rewriteOpenApiDiscriminators(doc: OpenAPIV3.Document): void {
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }

    if (!isObjectRecord(value)) {
      return
    }

    for (const child of Object.values(value)) {
      visit(child)
    }

    rewriteDiscriminatorSchema(doc, value)
  }

  visit(doc)
}
