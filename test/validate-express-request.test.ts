import type {NextFunction, Request, Response} from "express"

import {loadGeneratedValidator} from "./helpers/load-generated-validator"
import {RequestValidationError, validateExpressRequest, withExpressValidation} from "../src"

describe("validateExpressRequest", () => {
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

  test("accepts a valid Express request object", () => {
    const request = {
      headers: {
        "x-request-id": "req-333",
      },
      query: {
        includeMeta: "true",
      },
      params: {
        customerId: "customer-33",
      },
      body: {
        amount: 12,
        note: "express-order",
      },
    } as unknown as Request

    expect(() =>
      validateExpressRequest(validateCreateCustomerOrderRequest, request),
    ).not.toThrow()
  })

  test("withExpressValidation forwards validation errors to next", () => {
    const handler = jest.fn(() => "ok")
    const next = jest.fn<ReturnType<NextFunction>, Parameters<NextFunction>>()
    const wrappedHandler = withExpressValidation(validateCreateCustomerOrderRequest, handler)

    const result = wrappedHandler(
      {
        headers: {},
        params: {
          customerId: "customer-33",
        },
        body: {
          amount: 12,
        },
      } as unknown as Request,
      {} as Response,
      next as unknown as NextFunction,
    )

    expect(result).toBeUndefined()
    expect(handler).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    const forwardedError: unknown = next.mock.calls[0]?.[0]
    expect(forwardedError).toBeInstanceOf(RequestValidationError)
    expect(forwardedError instanceof Error ? forwardedError.message : "").toContain(
      "request must have required property 'headers'",
    )
  })
})
