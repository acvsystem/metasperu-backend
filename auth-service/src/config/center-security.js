import jwt from 'jsonwebtoken';
import { poolCenter } from './db-center.js';
import { createCenterSecurity } from '../../../shared/center-security.mjs';
let instance;
export function getCenterSecurity() {
  return instance ??= createCenterSecurity({ jwt, pool: poolCenter, secret: process.env.CENTER_JWT_SECRET });
}
