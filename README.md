# openapi-request-validation

Provides request validation based on OpenAPI specifications for serverless and lightweight Node runtimes.

Used to generate validator code based on an OpenAPI spec and offers runtime validation helpers to validate requests objects.
Supports AWS Lambda API Gateway events, lambda-api requests and Express.

Uses AJV to generate standalone request validators and ships runtime helpers for easy validation.

## Install

Install the package as a normal dependency, since it is required both at build time and runtime:
```bash
npm install openapi-request-validation
```

## CLI

Generate validators from a spec into a target directory:

```bash
openapi-request-validation ./openapi.yaml ./src/generated
```

This writes a file such as `./src/generated/openapi-validators.js`. Each operation with a request shape gets an export
like `validateCreateUserRequest`. Your tsconfig must specify `allowJs: true` to use these validators.

## Runtime use

### API Gateway

Use `validateApiGatewayEvent(...)` to validate a raw API Gateway event before your handler logic runs.

```ts
import {validateCreateCustomerOrderRequest} from "./generated/openapi-validators.js"
import {validateApiGatewayEvent} from "openapi-request-validation"

export async function handler(event: unknown) {
  validateApiGatewayEvent(validateCreateCustomerOrderRequest, event)

  return {
    statusCode: 204,
  }
}
```

### lambda-api

Wrap route handlers with `withValidation(...)` or call `validateLambdaApiRequest(...)` directly.

```ts
import {validateCreateCustomerOrderRequest} from "./generated/openapi-validators.js"
import {withValidation} from "openapi-request-validation"

api.post(
  "/customers/:customerId/orders",
  withValidation(validateCreateCustomerOrderRequest, (req, res) => {
    res.send({ok: true})
  }),
)
```

### Express

Wrap Express handlers with `withExpressValidation(...)` or call `validateExpressRequest(...)` directly.

```ts
import express from "express"
import {validateCreateCustomerOrderRequest} from "./generated/openapi-validators.js"
import {withExpressValidation} from "openapi-request-validation"

const app = express()
app.use(express.json())

app.post(
  "/customers/:customerId/orders",
  withExpressValidation(validateCreateCustomerOrderRequest, (req, res) => {
    res.status(201).json({ok: true})
  }),
)
```

## Error handling

The runtime helpers throw `RequestValidationError` with HTTP status `400`.

If your application already uses its own error type, pass `createError` in the optional runtime options:

```ts
import {validateExpressRequest} from "openapi-request-validation"

validateExpressRequest(validateCreateCustomerOrderRequest, req, {
  createError: (message) => new BadRequestProblem(message),
})
```

## Release automation

This repo uses the release-please flow for release automation.
