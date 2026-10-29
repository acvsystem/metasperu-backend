import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { createCenterBoundary } from '../../../shared/center-boundary.mjs';
import { createOriginPolicy } from '../../../shared/inventory-security.mjs';
export const boundary = createCenterBoundary({ jwt, pool, secret: process.env.CENTER_JWT_SECRET });
export const origins = createOriginPolicy(process.env.CORS_ORIGINS);
