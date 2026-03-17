import type {OpenAPIV3} from "openapi-types";

export function isOpenApiV3(doc: unknown): doc is OpenAPIV3.Document {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "openapi" in doc &&
    typeof (doc as { openapi?: unknown }).openapi === "string" &&
    (doc as { openapi: string }).openapi.startsWith("3.")
  )
}