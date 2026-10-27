import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import {
  createInventorySecurity,
  createOriginPolicy,
} from '../../../shared/inventory-security.mjs';
export const security = createInventorySecurity({
  jwt,
  pool,
  secret: process.env.INVENTORY_JWT_SECRET,
});
export const origins = createOriginPolicy(process.env.CORS_ORIGINS);
