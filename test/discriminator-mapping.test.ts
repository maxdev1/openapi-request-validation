import {RequestValidationError, validateApiGatewayEvent} from "../src"
import {loadGeneratedValidators} from "./helpers/load-generated-validator"

describe("discriminator mappings", () => {
  let cleanup: () => void = () => {
  }
  let validateCreateItemRequest: (value: unknown) => boolean

  beforeAll(async () => {
    const loaded = await loadGeneratedValidators({fixtureName: "discriminator-mapping-api.yaml"})
    cleanup = loaded.cleanup
    validateCreateItemRequest = loaded.getValidator("validateCreateItemRequest")
  })

  afterAll(() => {
    cleanup()
  })

  test("accepts the mapped embedded branch even when the branch inherits the discriminator property", () => {
    expect(() =>
      validateApiGatewayEvent(validateCreateItemRequest, {
        body: JSON.stringify({
          item: {
            type: "EMBEDDED",
            code: "embedded-item",
            value: 25
          },
        }),
      }),
    ).not.toThrow()
  })

  test("only reports errors from the discriminator-selected branch", () => {
    let thrownError: unknown

    try {
      validateApiGatewayEvent(validateCreateItemRequest, {
        body: JSON.stringify({
          item: {
            type: "EMBEDDED",
          },
        }),
      })
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).toBeInstanceOf(RequestValidationError)

    const validationError = thrownError as RequestValidationError
    const missingProperties = validationError.errors
      .map((error) => error.params)
      .filter((params): params is {missingProperty: string} => typeof params === "object" && params !== null && "missingProperty" in params)
      .map((params) => params.missingProperty)
      .sort()

    expect(missingProperties).toEqual(["code"])
  })
})
