import SwaggerParser from "@apidevtools/swagger-parser"
import type {OpenAPIV3} from "openapi-types"
import {isOpenApiV3} from "./is-open-api-v3.js"


/**
 * Node-only helper for loading specs from a filesystem path and resolving
 * local or relative external refs through swagger-parser.
 */
export async function loadSpecFromPath(specPath: string): Promise<OpenAPIV3.Document> {
  const bundledSpec = await SwaggerParser.bundle(specPath)
  if (!isOpenApiV3(bundledSpec)) {
    throw new Error("Only OpenAPI v3 specs are supported")
  }

  return bundledSpec
}
