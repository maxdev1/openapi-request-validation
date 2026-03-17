#!/usr/bin/env node

import {mkdirSync, writeFileSync} from "node:fs"
import {basename, dirname, extname, join} from "node:path"
import {generateApiValidatorsFromPath} from "./generator/generator.js"

function printUsage(): void {
  console.error("Usage: openapi-request-validation <openapi-spec-path> <target-directory>")
}

function createOutputBaseName(specPath: string): string {
  const rawBaseName = basename(specPath, extname(specPath))
  const sanitized = rawBaseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return sanitized || "openapi"
}

function writeValidatorModule(specPath: string, outputDir: string, code: string): string {
  const outputPath = join(outputDir, `${createOutputBaseName(specPath)}-validators.js`)
  mkdirSync(dirname(outputPath), {recursive: true})
  writeFileSync(outputPath, code, "utf8")
  return outputPath
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    printUsage()
    return
  }

  if (args.length !== 2) {
    printUsage()
    process.exitCode = 1
    return
  }

  const specPath = args[0]
  const outputDir = args[1]
  if (!specPath || !outputDir) {
    printUsage()
    process.exitCode = 1
    return
  }
  const result = await generateApiValidatorsFromPath(specPath)
  const outputPath = writeValidatorModule(specPath, outputDir, result.code)

  console.log(
    `Generated ${result.validatorCount} validator(s) from ${specPath} into ${outputPath}`,
  )
}

main().catch((error: unknown) => {
  console.error("Failed to generate validators:", error)
  process.exitCode = 1
})
