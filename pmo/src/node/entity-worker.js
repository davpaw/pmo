import { parentPort, workerData } from 'node:worker_threads'
import { scanEntities } from './entity-scan.js'
try { parentPort.postMessage({ ok: true, snapshot: scanEntities(workerData) }) }
catch { parentPort.postMessage({ ok: false }) }