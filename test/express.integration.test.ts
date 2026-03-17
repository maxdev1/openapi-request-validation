import type {AddressInfo} from "node:net"
import {createServer, type Server} from "node:http"

import express, {type ErrorRequestHandler, type Request, type Response} from "express"

import {loadGeneratedValidator} from "./helpers/load-generated-validator"
import {RequestValidationError, withExpressValidation} from "../src"

describe("Express integration", () => {
  let cleanup: () => void = () => {
  }
  let server: Server | undefined
  let baseUrl = ""
  let validateCreateCustomerOrderRequest: (value: unknown) => boolean

  beforeAll(async () => {
    const loaded = await loadGeneratedValidator()
    cleanup = loaded.cleanup
    validateCreateCustomerOrderRequest = loaded.validateCreateCustomerOrderRequest

    const app = express()
    app.use(express.json())

    app.post(
      "/customers/:customerId/orders",
      withExpressValidation(
        validateCreateCustomerOrderRequest,
        (req: Request, res: Response) => {
          res.status(201).json({
            ok: true,
            customerId: req.params.customerId,
            includeMeta: req.query.includeMeta,
            amount: req.body.amount,
          })
        },
      ),
    )

    const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
      if (error instanceof RequestValidationError) {
        res.status(error.statusCode).json({
          message: error.message,
        })
        return
      }

      res.status(500).json({
        message: "unexpected error",
      })
    }

    app.use(errorHandler)

    server = createServer(app)
    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve())
    })

    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("Expected server to listen on a TCP address")
    }

    baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve()
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })

    cleanup()
  })

  test("accepts a valid request over real HTTP", async () => {
    const response = await fetch(`${baseUrl}/customers/customer-88/orders?includeMeta=true`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-integration-1",
      },
      body: JSON.stringify({
        amount: 44,
        note: "integration",
      }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      customerId: "customer-88",
      includeMeta: "true",
      amount: 44,
    })
  })

  test("rejects invalid requests over real HTTP", async () => {
    const response = await fetch(`${baseUrl}/customers/customer-88/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        note: "missing amount and header",
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: expect.stringContaining("must have required property 'x-request-id'"),
    })
  })
})
