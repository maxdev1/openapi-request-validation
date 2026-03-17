import {Buffer} from "node:buffer"

import {loadGeneratedValidators} from "./helpers/load-generated-validator"
import {validateApiGatewayEvent, validateLambdaApiRequest} from "../src"

type ValidationFunction = (value: unknown) => boolean

describe("OpenAPI composition schemas", () => {
  let cleanup: () => void = () => {
  }
  let validateSavePaymentPreferenceRequest: ValidationFunction
  let validateSaveContactPreferenceRequest: ValidationFunction
  let validateSaveNotificationPreferenceRequest: ValidationFunction

  beforeAll(async () => {
    const loaded = await loadGeneratedValidators({fixtureName: "composition-api.yaml"})
    cleanup = loaded.cleanup
    validateSavePaymentPreferenceRequest = loaded.getValidator("validateSavePaymentPreferenceRequest")
    validateSaveContactPreferenceRequest = loaded.getValidator("validateSaveContactPreferenceRequest")
    validateSaveNotificationPreferenceRequest = loaded.getValidator("validateSaveNotificationPreferenceRequest")
  })

  afterAll(() => {
    cleanup()
  })

  test("accepts a payload matching exactly one oneOf branch", () => {
    expect(() =>
      validateApiGatewayEvent(validateSavePaymentPreferenceRequest, {
        headers: {
          "X-Request-Id": "req-oneof-valid",
        },
        pathParameters: {
          customerId: "customer-15",
        },
        body: JSON.stringify({
          cardToken: "tok_live_123",
        }),
      }),
    ).not.toThrow()
  })

  test("rejects a payload matching multiple oneOf branches", () => {
    expect(() =>
      validateApiGatewayEvent(validateSavePaymentPreferenceRequest, {
        headers: {
          "X-Request-Id": "req-oneof-ambiguous",
        },
        pathParameters: {
          customerId: "customer-15",
        },
        body: Buffer.from(
          JSON.stringify({
            cardToken: "tok_live_123",
            invoiceNumber: "INV-123",
          }),
          "utf8",
        ).toString("base64"),
        isBase64Encoded: true,
      }),
    ).toThrow("must match exactly one schema in oneOf")
  })

  test("accepts a payload matching one anyOf branch", () => {
    expect(() =>
      validateLambdaApiRequest(validateSaveContactPreferenceRequest, {
        headers: {
          "x-request-id": "req-anyof-email",
        },
        params: {
          customerId: "customer-16",
        },
        body: {
          email: "customer@example.com",
        },
      }),
    ).not.toThrow()
  })

  test("accepts a payload matching multiple anyOf branches", () => {
    expect(() =>
      validateLambdaApiRequest(validateSaveContactPreferenceRequest, {
        headers: {
          "x-request-id": "req-anyof-both",
        },
        params: {
          customerId: "customer-16",
        },
        body: {
          email: "customer@example.com",
          phone: "+491701234567",
        },
      }),
    ).not.toThrow()
  })

  test("rejects a payload matching no anyOf branch", () => {
    expect(() =>
      validateLambdaApiRequest(validateSaveContactPreferenceRequest, {
        headers: {
          "x-request-id": "req-anyof-invalid",
        },
        params: {
          customerId: "customer-16",
        },
        body: {
          pushToken: "device-1",
        },
      }),
    ).toThrow("must match a schema in anyOf")
  })

  test("accepts a discriminator-based oneOf branch", () => {
    expect(() =>
      validateApiGatewayEvent(validateSaveNotificationPreferenceRequest, {
        headers: {
          "X-Request-Id": "req-discriminator-valid",
        },
        pathParameters: {
          customerId: "customer-17",
        },
        body: JSON.stringify({
          channel: "email",
          email: "notify@example.com",
        }),
      }),
    ).not.toThrow()
  })

  test("rejects an unknown discriminator value", () => {
    expect(() =>
      validateApiGatewayEvent(validateSaveNotificationPreferenceRequest, {
        headers: {
          "X-Request-Id": "req-discriminator-invalid",
        },
        pathParameters: {
          customerId: "customer-17",
        },
        body: JSON.stringify({
          channel: "push",
          pushToken: "device-token",
        }),
      }),
    ).toThrow("must match exactly one schema in oneOf")
  })
})
