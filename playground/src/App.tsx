import {useDeferredValue, useEffect, useState} from "react"
import {compileApiValidators} from "./compile-api-validators"

type ValidatorError = {
  instancePath?: string
  message?: string
  params?: Record<string, unknown>
}

type GeneratedValidator = ((value: unknown) => boolean) & {
  errors?: ValidatorError[] | null
}

type GeneratedModule = Record<string, unknown>

type GenerationState = {
  status: "idle" | "generating" | "ready" | "error"
  validatorNames: string[]
  validators: GeneratedModule | null
  error: string | null
}

type ValidationState =
  | {
    status: "idle"
    valid: null
    errors: ValidatorError[]
    error: string | null
  }
  | {
    status: "ready"
    valid: boolean
    errors: ValidatorError[]
    error: string | null
  }
  | {
    status: "error"
    valid: null
    errors: ValidatorError[]
    error: string
  }

type PayloadMode = "json" | "structured"

type ParameterRow = {
  id: string
  key: string
  value: string
}

type StructuredPayloadState = {
  headers: ParameterRow[]
  query: ParameterRow[]
  path: ParameterRow[]
  bodyText: string
}

type TableEditorProps = {
  label: string
  rows: ParameterRow[]
  onChange: (rows: ParameterRow[]) => void
}

const REQUEST_LIKE_KEYS = new Set([
  "headers",
  "multiValueHeaders",
  "query",
  "queryStringParameters",
  "multiValueQueryStringParameters",
  "path",
  "params",
  "pathParameters",
  "body",
])

const defaultSpec = `openapi: 3.0.3
info:
  title: Playground API
  version: 1.0.0
paths:
  /customers/{customerId}/orders:
    post:
      operationId: createCustomerOrder
      parameters:
        - name: customerId
          in: path
          required: true
          schema:
            type: string
        - name: includeMeta
          in: query
          schema:
            type: boolean
        - name: x-request-id
          in: header
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                amount:
                  type: integer
                note:
                  type: string
              required:
                - amount
              additionalProperties: false
      responses:
        "201":
          description: Created
  /customers/{customerId}/contact-preferences:
    post:
      operationId: saveContactPreference
      parameters:
        - name: customerId
          in: path
          required: true
          schema:
            type: string
        - name: x-request-id
          in: header
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              anyOf:
                - type: object
                  properties:
                    email:
                      type: string
                      format: email
                  required:
                    - email
                - type: object
                  properties:
                    phone:
                      type: string
                  required:
                    - phone
      responses:
        "204":
          description: Saved
`

const defaultPayload = `{
  "headers": {
    "x-request-id": "req-123"
  },
  "query": {
    "includeMeta": "true"
  },
  "path": {
    "customerId": "customer-42"
  },
  "body": {
    "amount": 3,
    "note": "priority"
  }
}`

function createRow(key = "", value = ""): ParameterRow {
  return {
    id: Math.random().toString(36).slice(2, 10),
    key,
    value,
  }
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const result: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (entry != null) {
      result[key] = entry
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeHeaders(headers: unknown, multiValueHeaders?: unknown): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}

  for (const source of [headers, multiValueHeaders]) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue
    }

    for (const [rawKey, rawValue] of Object.entries(source)) {
      if (!rawKey || rawValue == null) {
        continue
      }

      const key = rawKey.toLowerCase()

      if (Array.isArray(rawValue)) {
        if (rawValue.length === 1) {
          result[key] = rawValue[0]
        } else if (rawValue.length > 1) {
          result[key] = rawValue
        }
      } else {
        result[key] = rawValue
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeQuery(query: unknown, multiValueQuery?: unknown): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}

  if (query && typeof query === "object" && !Array.isArray(query)) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) {
        result[key] = value
      }
    }
  }

  if (multiValueQuery && typeof multiValueQuery === "object" && !Array.isArray(multiValueQuery)) {
    for (const [key, value] of Object.entries(multiValueQuery)) {
      if (!Array.isArray(value) || value.length === 0) {
        continue
      }

      result[key] = value.length === 1 ? value[0] : value
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatValidatorErrors(errors: ValidatorError[]): string {
  if (errors.length === 0) {
    return "No validation errors."
  }

  return JSON.stringify(errors, null, 2)
}

function hasRequestLikeKeys(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => REQUEST_LIKE_KEYS.has(key))
  )
}

function normalizeRequestLike(value: Record<string, unknown>): Record<string, unknown> {
  return compactObject({
    headers: normalizeHeaders(value.headers, value.multiValueHeaders),
    query: normalizeQuery(value.query ?? value.queryStringParameters, value.multiValueQueryStringParameters),
    path: normalizeRecord(value.path ?? value.params ?? value.pathParameters),
    body: value.body,
  })
}

function normalizePlaygroundPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  if (record.request && typeof record.request === "object" && !Array.isArray(record.request)) {
    return normalizeRequestLike(record.request as Record<string, unknown>)
  }

  if (hasRequestLikeKeys(record)) {
    return normalizeRequestLike(record)
  }

  return value
}

function stringifyRowValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (value == null) {
    return ""
  }

  if (typeof value === "object") {
    return JSON.stringify(value)
  }

  return String(value)
}

function rowsFromRecord(record: unknown): ParameterRow[] {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return []
  }

  return Object.entries(record).map(([key, value]) => createRow(key, stringifyRowValue(value)))
}

function buildStructuredStateFromPayload(value: unknown): StructuredPayloadState {
  const normalized = normalizePlaygroundPayload(value)

  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return {
      headers: [],
      query: [],
      path: [],
      bodyText: "",
    }
  }

  const record = normalized as Record<string, unknown>

  return {
    headers: rowsFromRecord(record.headers),
    query: rowsFromRecord(record.query),
    path: rowsFromRecord(record.path),
    bodyText: record.body === undefined ? "" : JSON.stringify(record.body, null, 2),
  }
}

function rowsToRecord(rows: ParameterRow[], normalizeKeys = false): Record<string, string> | undefined {
  const result: Record<string, string> = {}

  for (const row of rows) {
    const trimmedKey = row.key.trim()
    if (!trimmedKey) {
      continue
    }

    result[normalizeKeys ? trimmedKey.toLowerCase() : trimmedKey] = row.value
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function buildStructuredPayload(state: StructuredPayloadState): unknown {
  const body = state.bodyText.trim() === "" ? undefined : JSON.parse(state.bodyText)

  return compactObject({
    headers: rowsToRecord(state.headers, true),
    query: rowsToRecord(state.query),
    path: rowsToRecord(state.path),
    body,
  })
}

function KeyValueTableEditor({label, rows, onChange}: TableEditorProps) {
  function updateRow(id: string, field: "key" | "value", nextValue: string) {
    onChange(rows.map((row) => (row.id === id ? {...row, [field]: nextValue} : row)))
  }

  function addRow() {
    onChange([...rows, createRow()])
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id))
  }

  return (
    <section className="table-editor">
      <div className="table-editor-header">
        <h3>{label}</h3>
        <button className="mini-button" type="button" onClick={addRow}>
          Add row
        </button>
      </div>
      {rows.length === 0 ? <div className="table-empty">No entries</div> : null}
      <div className="table-rows">
        {rows.map((row) => (
          <div className="table-row" key={row.id}>
            <input
              value={row.key}
              placeholder="name"
              onChange={(event) => updateRow(row.id, "key", event.target.value)}
            />
            <input
              value={row.value}
              placeholder="value"
              onChange={(event) => updateRow(row.id, "value", event.target.value)}
            />
            <button className="row-button" type="button" onClick={() => removeRow(row.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function App() {
  const [specText, setSpecText] = useState(defaultSpec)
  const deferredSpecText = useDeferredValue(specText)
  const [selectedValidator, setSelectedValidator] = useState("")
  const [payloadMode, setPayloadMode] = useState<PayloadMode>("json")
  const [payloadText, setPayloadText] = useState(defaultPayload)
  const [structuredPayload, setStructuredPayload] = useState<StructuredPayloadState>({
    headers: [createRow("x-request-id", "req-123")],
    query: [createRow("includeMeta", "true")],
    path: [createRow("customerId", "customer-42")],
    bodyText: JSON.stringify(
      {
        amount: 3,
        note: "priority",
      },
      null,
      2,
    ),
  })
  const [generationState, setGenerationState] = useState<GenerationState>({
    status: "idle",
    validatorNames: [],
    validators: null,
    error: null,
  })
  const [validationState, setValidationState] = useState<ValidationState>({
    status: "idle",
    valid: null,
    errors: [],
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setGenerationState((current) => ({
          ...current,
          status: "generating",
          error: null,
        }))

        try {
          const generated = await compileApiValidators({spec: deferredSpecText})
          const validatorNames = Object.keys(generated.validators)

          if (cancelled) {
            return
          }

          setGenerationState({
            status: "ready",
            validatorNames,
            validators: generated.validators,
            error: null,
          })
          setSelectedValidator((current) => {
            if (current && validatorNames.includes(current)) {
              return current
            }

            return validatorNames[0] ?? ""
          })
        } catch (error) {
          if (cancelled) {
            return
          }

          setGenerationState({
            status: "error",
            validatorNames: [],
            validators: null,
            error: getErrorMessage(error),
          })
        }
      })()
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [deferredSpecText])

  useEffect(() => {
    if (!generationState.validators || !selectedValidator) {
      setValidationState({
        status: "idle",
        valid: null,
        errors: [],
        error: null,
      })
      return
    }

    try {
      const payload = payloadMode === "json"
        ? normalizePlaygroundPayload(structuredClone(JSON.parse(payloadText)))
        : buildStructuredPayload(structuredPayload)
      const validator = generationState.validators[selectedValidator] as GeneratedValidator | undefined

      if (typeof validator !== "function") {
        setValidationState({
          status: "error",
          valid: null,
          errors: [],
          error: `Validator "${selectedValidator}" is not available in the compiled validator set.`,
        })
        return
      }

      const valid = validator(payload)
      setValidationState({
        status: "ready",
        valid,
        errors: validator.errors ?? [],
        error: null,
      })
    } catch (error) {
      setValidationState({
        status: "error",
        valid: null,
        errors: [],
        error: getErrorMessage(error),
      })
    }
  }, [generationState.validators, payloadMode, payloadText, selectedValidator, structuredPayload])

  function updateStructuredRows(key: "headers" | "query" | "path", rows: ParameterRow[]) {
    setStructuredPayload((current) => ({
      ...current,
      [key]: rows,
    }))
  }

  function switchPayloadMode(nextMode: PayloadMode) {
    if (nextMode === payloadMode) {
      return
    }

    if (nextMode === "structured") {
      try {
        setStructuredPayload(buildStructuredStateFromPayload(JSON.parse(payloadText)))
      } catch {
        // Keep the existing structured editor state if the raw JSON is not parseable
      }
    } else {
      try {
        setPayloadText(JSON.stringify(buildStructuredPayload(structuredPayload), null, 2))
      } catch {
        // Keep the existing raw JSON if the structured body editor is not parseable
      }
    }

    setPayloadMode(nextMode)
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <h1>openapi-request-validation</h1>
        </div>
      </header>

      <main className="workspace">
        <section className="panel panel-spec">
          <div className="panel-header">
            <div>
              <h2>Spec Source</h2>
              <p>Paste your OpenAPI 3 specification as YAML or JSON.</p>
            </div>
          </div>
          {generationState.error ? (
            <div className="message message-error">{generationState.error}</div>
          ) : null}
          <textarea
            className="editor"
            spellCheck={false}
            value={specText}
            onChange={(event) => setSpecText(event.target.value)}
          />
        </section>

        <section className="panel panel-payload">
          <div className="panel-header">
            <div>
              <h2>Request Payload</h2>
            </div>
            <span className="metric">{generationState.validatorNames.length} export(s)</span>
          </div>

          <label className="field">
            <span>Select validator</span>
            <select
              value={selectedValidator}
              onChange={(event) => setSelectedValidator(event.target.value)}
              disabled={generationState.validatorNames.length === 0}
            >
              {generationState.validatorNames.length === 0 ? (
                <option value="">No validators generated</option>
              ) : (
                generationState.validatorNames.map((validatorName) => (
                  <option key={validatorName} value={validatorName}>
                    {validatorName}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="mode-switch" role="tablist" aria-label="Payload editor mode">
            <button
              className={`mode-button ${payloadMode === "json" ? "mode-button-active" : ""}`}
              type="button"
              onClick={() => switchPayloadMode("json")}
            >
              Plain JSON
            </button>
            <button
              className={`mode-button ${payloadMode === "structured" ? "mode-button-active" : ""}`}
              type="button"
              onClick={() => switchPayloadMode("structured")}
            >
              Structured
            </button>
          </div>

          {payloadMode === "json" ? (
            <textarea
              className="editor"
              spellCheck={false}
              value={payloadText}
              onChange={(event) => setPayloadText(event.target.value)}
            />
          ) : (
            <div className="structured-editor">
              <div className="table-grid">
                <KeyValueTableEditor
                  label="Headers"
                  rows={structuredPayload.headers}
                  onChange={(rows) => updateStructuredRows("headers", rows)}
                />
                <KeyValueTableEditor
                  label="Query"
                  rows={structuredPayload.query}
                  onChange={(rows) => updateStructuredRows("query", rows)}
                />
                <KeyValueTableEditor
                  label="Path"
                  rows={structuredPayload.path}
                  onChange={(rows) => updateStructuredRows("path", rows)}
                />
              </div>

              <label className="field body-field">
                <span>Body JSON</span>
                <textarea
                  className="editor body-editor"
                  spellCheck={false}
                  value={structuredPayload.bodyText}
                  onChange={(event) => {
                    setStructuredPayload((current) => ({
                      ...current,
                      bodyText: event.target.value,
                    }))
                  }}
                />
              </label>
            </div>
          )}
        </section>

        <section className="panel panel-results">
          <div className="panel-header">
            <div>
              <h2>Validation Result</h2>
            </div>
          </div>

          {validationState.error ? (
            <div className="message message-error">{validationState.error}</div>
          ) : (
            <div className={`message ${validationState.valid ? "message-valid" : "message-neutral"}`}>
              {validationState.valid === null
                ? "Select a validator and provide a payload."
                : validationState.valid
                  ? "Payload is valid."
                  : "Payload is invalid."}
            </div>
          )}

          <div>
            <h3>Errors</h3>
            <pre className="result-block">{formatValidatorErrors(validationState.errors)}</pre>
          </div>
        </section>
      </main>
    </div>
  )
}
