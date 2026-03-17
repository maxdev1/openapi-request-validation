import {execFileSync} from "node:child_process"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {pathToFileURL} from "node:url"
import type {ErrorObject} from "ajv"
import {generateApiValidatorsFromDocument, loadSpecFromPath} from "../../src/generator"

type GeneratedValidationFunction = ((value: unknown) => boolean) & {
  errors?: ErrorObject[] | null
}

type LoadGeneratedValidatorsOptions = {
  fixtureName?: string
}

const generatedValidatorRunner = `
const [moduleUrl, exportName, payloadJson] = process.argv.slice(1)
const generatedModule = await import(moduleUrl)
const validate = generatedModule[exportName]

if (typeof validate !== "function") {
  throw new Error(\`Missing validator export: \${exportName}\`)
}

const value = JSON.parse(payloadJson)
const valid = validate(value)

process.stdout.write(JSON.stringify({
  valid,
  errors: validate.errors ?? null,
}))
`

function createGeneratedValidator(moduleUrl: string, exportName: string): GeneratedValidationFunction {
  const validationFunction = ((value: unknown) => {
    // Run the generated validator through a real Node ESM process so the test
    // exercises the emitted module, not a hand-translated test double.
    const result = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        generatedValidatorRunner,
        moduleUrl,
        exportName,
        JSON.stringify(value),
      ],
      {
        encoding: "utf8",
      },
    ).trim()

    const parsedResult = JSON.parse(result) as {
      valid: boolean
      errors: ErrorObject[] | null
    }

    validationFunction.errors = parsedResult.errors
    return parsedResult.valid
  }) as GeneratedValidationFunction

  validationFunction.errors = null
  return validationFunction
}

export async function loadGeneratedValidators(
  options: LoadGeneratedValidatorsOptions = {},
) {
  const outputDir = mkdtempSync(join(tmpdir(), "openapi-request-validation-"))
  const specPath = join(process.cwd(), "test", "fixtures", options.fixtureName ?? "order-api.yaml")
  const spec = await loadSpecFromPath(specPath)
  const result = await generateApiValidatorsFromDocument(spec)
  const generatedValidatorPath = join(outputDir, "generated-validators.js")
  writeFileSync(generatedValidatorPath, result.code, "utf8")
  const generatedValidatorUrl = pathToFileURL(generatedValidatorPath).href

  return {
    cleanup: () => rmSync(outputDir, {recursive: true, force: true}),
    getValidator: (exportName: string) => createGeneratedValidator(generatedValidatorUrl, exportName),
  }
}

export async function loadGeneratedValidator() {
  const loaded = await loadGeneratedValidators()

  return {
    cleanup: loaded.cleanup,
    validateCreateCustomerOrderRequest: loaded.getValidator("validateCreateCustomerOrderRequest"),
  }
}
