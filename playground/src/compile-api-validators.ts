import type {ErrorObject} from "ajv"
import {Ajv} from "ajv"
import addAjvFormats from "ajv-formats"
import type {OpenAPIV3} from "openapi-types"
import {prepareValidatorArtifacts} from "../../src/generator/validator-artifacts.js"
import {
  loadOpenApiV3Spec,
  type LoadOpenApiV3SpecOptions,
} from "./load-openapi-spec"

export type CompiledValidationFunction = ((value: unknown) => boolean) & {
  errors?: ErrorObject[] | null
}

export type CompiledValidatorModule = {
  validatorCount: number
  validators: Record<string, CompiledValidationFunction>
}

function createAjvInstance(): Ajv {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    coerceTypes: "array",
    formats: {
      "iso-4217": true,
    },
  })

  addAjvFormats(ajv)
  return ajv
}

export function compileApiValidatorsFromDocument(
  spec: OpenAPIV3.Document,
): CompiledValidatorModule {
  const {spec: specForValidation, validators} = prepareValidatorArtifacts(spec)
  const ajv = createAjvInstance()
  ajv.addSchema(specForValidation, "Spec")

  const compiledValidators: Record<string, CompiledValidationFunction> = {}

  for (const [exportName, schemaRef] of Object.entries(validators)) {
    const validator = ajv.getSchema(schemaRef)

    if (!validator) {
      throw new Error(`Failed to compile validator for schema ref: ${schemaRef}`)
    }

    compiledValidators[exportName] = validator as CompiledValidationFunction
  }

  return {
    validatorCount: Object.keys(compiledValidators).length,
    validators: compiledValidators,
  }
}

export async function compileApiValidators(
  options: LoadOpenApiV3SpecOptions,
): Promise<CompiledValidatorModule> {
  const spec = await loadOpenApiV3Spec(options)
  return compileApiValidatorsFromDocument(spec)
}
