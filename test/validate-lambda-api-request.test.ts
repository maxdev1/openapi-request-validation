import {loadGeneratedValidator} from "./helpers/load-generated-validator"
import {validateLambdaApiRequest, withLambdaApiValidation} from "../src";

describe("validateLambdaApiRequest", () => {
  let cleanup: () => void = () => {
  }
  let validateCreateCustomerOrderRequest: (value: unknown) => boolean

  beforeAll(async () => {
    const loaded = await loadGeneratedValidator()
    cleanup = loaded.cleanup
    validateCreateCustomerOrderRequest = loaded.validateCreateCustomerOrderRequest
  })

  afterAll(() => {
    cleanup()
  })

  test("accepts a valid lambda-api request object", () => {
    expect(() =>
      validateLambdaApiRequest(validateCreateCustomerOrderRequest, {
        headers: {
          "x-request-id": "req-456",
        },
        query: {
          includeMeta: "false",
        },
        params: {
          customerId: "customer-7",
        },
        body: {
          amount: 10,
          note: "gift-wrap",
        },
      }),
    ).not.toThrow()
  })

  test("withValidation validates before invoking the handler", () => {
    const handler = jest.fn(() => "ok")
    const wrappedHandler = withLambdaApiValidation(validateCreateCustomerOrderRequest, handler)

    expect(
      wrappedHandler(
        {
          headers: {
            "x-request-id": "req-789",
          },
          params: {
            customerId: "customer-7",
          },
          body: {
            amount: 15,
          },
        },
        {statusCode: 201},
      ),
    ).toBe("ok")
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test("rejects missing required request parts", () => {
    expect(() =>
      validateLambdaApiRequest(validateCreateCustomerOrderRequest, {
        headers: {},
        params: {
          customerId: "customer-7",
        },
        body: {
          amount: 10,
        },
      }),
    ).toThrow("request must have required property 'headers'")
  })
})
