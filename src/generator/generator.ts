import {Ajv} from "ajv"
import addAjvFormats from "ajv-formats"
import standaloneCode from "ajv/dist/standalone/index.js"
import type {OpenAPIV3} from "openapi-types"
import {loadSpecFromPath} from "./load-spec-from-path.js"
import {
  createUniqueName,
  prepareValidatorArtifacts,
  resolveLocalRef,
  type ValidatorExports,
} from "./validator-artifacts.js"

export type GeneratedValidatorModule = {
  code: string
  validatorCount: number
  validators: ValidatorExports
}

function createAjvInstance(): Ajv {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    coerceTypes: "array",
    formats: {
      "iso-4217": true,
    },
    code: {source: true, esm: true},
  })

  addAjvFormats(ajv)
  return ajv
}

async function generateValidatorModuleCode(
  spec: OpenAPIV3.Document,
  validators: ValidatorExports,
): Promise<string> {
  if (Object.keys(validators).length === 0) {
    return "export {}"
  }

  const ajv = createAjvInstance()
  ajv.addSchema(spec, "Spec")
  return standaloneCode(ajv, validators)
}

/**
 * Generates standalone validator code from an already loaded OpenAPI document.
 *
 * The generated module validates normalized request payloads shaped like
 * `{headers, query, path, body}` so the same validator can be reused across
 * API Gateway and lambda-api inputs.
 */
export async function generateApiValidatorsFromDocument(
  spec: OpenAPIV3.Document,
): Promise<GeneratedValidatorModule> {
  const {spec: specForGeneration, validators} = prepareValidatorArtifacts(spec)
  const code = await generateValidatorModuleCode(specForGeneration, validators)

  return {
    code,
    validatorCount: Object.keys(validators).length,
    validators,
  }
}

/**
 * Node-only convenience helper that loads an OpenAPI document from a file path
 * before generating the standalone validator module.
 */
export async function generateApiValidatorsFromPath(
  specPath: string,
): Promise<GeneratedValidatorModule> {
  const spec = await loadSpecFromPath(specPath)
  return generateApiValidatorsFromDocument(spec)
}

export {createUniqueName, resolveLocalRef}
