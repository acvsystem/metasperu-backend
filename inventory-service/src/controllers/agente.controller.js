import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';
import jwt from "jsonwebtoken";

export const agentController = {
    // LISTAR
    getConfiguration: async (req, res) => {
        console.log("Recibiendo solicitud de configuración del agente...", req.body);
        const mac =
            typeof req.body?.mac === "string"
                ? req.body.mac.trim().toUpperCase()
                : "";

        const formatoMac =
            /^(?:[0-9A-F]{12}|(?:[0-9A-F]{2}:){5}[0-9A-F]{2}|(?:[0-9A-F]{2}-){5}[0-9A-F]{2})$/;

        if (!formatoMac.test(mac)) {
            return res.status(400).json({ message: "La dirección MAC no es válida." });
        }

        try {
            const [configuration] = await pool.execute(
                `SELECT serie,nombre_tienda,database_instance,database_name,mac FROM tiendas td 
                INNER JOIN conf_plugin_store cgp on cgp.fk_id_tienda = td.id where UPPER(mac) = ?;`,
                [mac.toUpperCase()]
            );

            if (configuration.length === 0) {
                return res.status(404).json({ message: "Agente no configurado." });
            }

            if (configuration.length > 1) {
                console.error("Hay más de una configuración para la misma MAC.");
                return res.status(409).json({ message: "Configuración duplicada del agente." });
            }

            const config = configuration[0];

            const secret = process.env.INVENTORY_IMPORT_SECRET;
            if (!secret || secret.length < 64) {
                console.error("INVENTORY_IMPORT_SECRET no está configurado correctamente.");
                return res.status(500).json({ message: "Configuración del servidor incompleta." });
            }

            const token = jwt.sign(
                { kind: "store-import", store: config.serie, mac: config.mac },
                secret,
                {
                    algorithm: "HS256",
                    issuer: "inventory-importer",
                    audience: "inventory-import",
                    expiresIn: "24h",
                }
            );

            return res.json([{
                ...config,
                INVENTORY_TOKEN: token,
            }]);

        } catch (error) {
            console.error("Error al consultar configuración del agente:", error.code || error.name);
            return res.status(500).json({
                message: "No se pudo consultar la configuración del agente.",
            });
        }
    }
};
