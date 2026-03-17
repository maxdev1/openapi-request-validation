import {loadGeneratedValidators} from "./helpers/load-generated-validator"
import {validateApiGatewayEvent} from "../src"

describe("generated request schema name collisions", () => {
  let cleanup: () => void = () => {
  }
  let validateCreateItemREquest: (value: unknown) => boolean

  beforeAll(async () => {
    const loaded = await loadGeneratedValidators({fixtureName: "schema-name-collision-api.yaml"})
    cleanup = loaded.cleanup
    validateCreateItemREquest = loaded.getValidator("validateCreateItemRequest")
  })

  afterAll(() => {
    cleanup()
  })

  test("keeps component request body schemas distinct from synthesized request wrapper schemas", () => {
    expect(() =>
      validateApiGatewayEvent(validateCreateItemREquest, {
        body: JSON.stringify({
          code: "example",
          value: 25
        }),
      }),
    ).not.toThrow()
  })
})
