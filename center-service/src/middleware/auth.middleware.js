import { boundary } from '../config/security.js';
export const verifyToken = boundary.authenticate;
