import {Buffer} from "node:buffer"

import {loadGeneratedValidator} from "./helpers/load-generated-validator"
import {validateApiGatewayEvent} from "../src";

describe("validateApiGatewayEvent", () => {
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

  test("accepts a valid API Gateway event", () => {
    expect(() =>
      validateApiGatewayEvent(validateCreateCustomerOrderRequest, {
        headers: {
          "X-Request-Id": "req-123",
        },
        queryStringParameters: {
          includeMeta: "true",
        },
        pathParameters: {
          customerId: "customer-42",
        },
        body: JSON.stringify({
          amount: 3,
          note: "priority",
        }),
      }),
    ).not.toThrow()
  })

  test("rejects malformed JSON bodies before schema validation", () => {
    expect(() =>
      validateApiGatewayEvent(validateCreateCustomerOrderRequest, {
        headers: {
          "X-Request-Id": "req-123",
        },
        pathParameters: {
          customerId: "customer-42",
        },
        body: "{bad-json",
      }),
    ).toThrow("body must be valid JSON")
  })

  test("rejects schema-invalid payloads", () => {
    expect(() =>
      validateApiGatewayEvent(validateCreateCustomerOrderRequest, {
        headers: {
          "X-Request-Id": "req-123",
        },
        pathParameters: {
          customerId: "customer-42",
        },
        body: Buffer.from(JSON.stringify({note: "missing amount"}), "utf8").toString("base64"),
        isBase64Encoded: true,
      }),
    ).toThrow(/must have required property 'amount'/)
  })
})
