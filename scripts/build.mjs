import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(rootDir, "dist")
const tscPath = join(rootDir, "node_modules", "typescript", "lib", "tsc.js")

rmSync(distDir, { recursive: true, force: true })

runTsc("tsconfig.types.json")
runTsc("tsconfig.esm.json")
runTsc("tsconfig.cjs.json")

mkdirSync(join(distDir, "cjs"), { recursive: true })
writeFileSync(
  join(distDir, "cjs", "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8",
)

function runTsc(projectFile) {
  const result = spawnSync(process.execPath, [tscPath, "-p", projectFile], {
    cwd: rootDir,
    stdio: "inherit",
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
