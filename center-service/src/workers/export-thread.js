import { workerData,parentPort } from 'node:worker_threads';
import { pool } from '../config/db.js';
import { renderExport } from '../../../shared/center-export-renderer.mjs';
try {await renderExport({pool,root:workerData.root,job:workerData.job});parentPort.postMessage({ok:true});}
catch {parentPort.postMessage({ok:false});}
finally {await pool.end();}
