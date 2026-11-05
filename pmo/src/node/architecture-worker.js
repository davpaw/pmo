import { parentPort, workerData } from 'node:worker_threads'
import { scanArchitecture } from './architecture-scan.js'
try { parentPort.postMessage({ ok: true, graph: scanArchitecture({ root: workerData.root }) }) }
catch (error) { parentPort.postMessage({ ok: false, error: error.code === 'ARCH_METADATA' ? error.message : 'Cannot scan architecture. Verify module/architecture metadata and scan limits.' }) }
