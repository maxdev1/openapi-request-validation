import {execFileSync} from "node:child_process"

function runNode(args: string[]) {
  return execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim()
}

describe("package exports", () => {
  test("loads the root package in both ESM and CommonJS", () => {
    const esmOutput = runNode([
      "--input-type=module",
      "-e",
      "import('openapi-request-validation').then((m)=>console.log(typeof m.validateApiGatewayProxyEvent + ' ' + typeof m.withExpressValidation + ' ' + typeof m.validateExpressRequest))",
    ])
    const cjsOutput = runNode([
      "-e",
      "const m=require('openapi-request-validation'); console.log(typeof m.validateApiGatewayProxyEvent + ' ' + typeof m.withExpressValidation + ' ' + typeof m.validateExpressRequest)",
    ])

    expect(esmOutput).toBe("function function function")
    expect(cjsOutput).toBe("function function function")
  })

  test("loads the generator and runtime subpaths in both ESM and CommonJS", () => {
    const esmOutput = runNode([
      "--input-type=module",
      "-e",
      "Promise.all([import('openapi-request-validation/generator'), import('openapi-request-validation/runtime')]).then(([g,r])=>console.log(typeof g.generateApiValidatorsFromDocument + ' ' + typeof g.generateApiValidatorsFromPath + ' ' + typeof r.validateExpressRequest + ' ' + typeof r.validateApiGatewayProxyEvent))",
    ])
    const cjsOutput = runNode([
      "-e",
      "const g=require('openapi-request-validation/generator'); const r=require('openapi-request-validation/runtime'); console.log(typeof g.generateApiValidatorsFromDocument + ' ' + typeof g.generateApiValidatorsFromPath + ' ' + typeof r.validateExpressRequest + ' ' + typeof r.validateApiGatewayProxyEvent)",
    ])

    expect(esmOutput).toBe("function function function function")
    expect(cjsOutput).toBe("function function function function")
  })
})
