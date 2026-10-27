import dotenv from 'dotenv';
import { configureLocalInventory } from '../../shared/setup-inventory-local.mjs';

await configureLocalInventory(dotenv.parse);
console.log('Configuración local lista: auth http://127.0.0.1:3000 e inventario http://127.0.0.1:3001.');
console.log('Clave compartida configurada sin mostrarla. Se conservaron las credenciales MySQL.');
