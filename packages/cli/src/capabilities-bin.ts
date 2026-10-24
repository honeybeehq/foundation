import { runCapabilities } from './commands/capabilities.js'
import { processIo } from './io.js'

runCapabilities(process.argv.slice(2), processIo).then(
  code => { process.exitCode = code },
  error => { processIo.stderr(String(error)); process.exitCode = 1 },
)
