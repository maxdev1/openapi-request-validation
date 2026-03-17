export function toPascalIdentifier(value: string): string {
  const tokens = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const result = tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join("")
  return result ? result.replace(/^(\d)/, "_$1") : "Operation"
}