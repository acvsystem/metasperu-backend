import { pool } from '../config/db.js';
import { createRecordingController } from '../../../shared/center-recordings.mjs';
export const rrwebController = createRecordingController(pool);
