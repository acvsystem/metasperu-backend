import { getIO } from '../config/socket.js';
import { emailService } from '../services/email.service.js';
import { pool } from '../config/db.js';

const arDataAsistenciaEmpleados = [{
    ejb: []
}];

export const storeController = {

    callAsistenceEmployesStore: async (req, res) => {
        const { fecha, tipoConsulta } = req.body; // Asegúrate que Python envíe la marca

        if (!fecha || !tipoConsulta) {
            return res.status(400).json({ message: 'Fecha y Tipo de Consulta son requeridos' });
        }

        try {
            const propertyUnique = Math.random().toString(36).substring(2, 8).toUpperCase();

            getIO().to('servidor_backup').emit('py_asistencia_empleados', { fecha, tipoConsulta, propertyUnique });
            res.status(200).json({ property: propertyUnique, message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    callRegisterEmployesStore: async (req, res) => {
        try {

            getIO().to('servidor_ejb').emit('py_registro_empleados');
            res.status(200).json({ message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    postAsistenciaEmployesStore: async (req, res) => {
        const { propertyUnique, data } = req.body;

        if (!data) {
            return res.status(400).json({ message: 'Data es requerido' });
        }

        try {

            console.log(arDataAsistenciaEmpleados);
            arDataAsistenciaEmpleados[0][`${propertyUnique}`] = procesarReporteBackend(arDataAsistenciaEmpleados[0][`ejb`], data);
            getIO().emit('dashboard_refresh_empleados');
            res.status(200).json({ message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }

    },
    postEjbRegisterEmployes: async (req, res) => {
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({ message: 'Data es requerido' });
        }

        try {
            const empleadosUnicos = Array.from(
                new Map(
                    data.map(empleado => [
                        empleado.NUMDOC.trim(), // La llave del Map será el DNI limpio
                        empleado                // El valor será el objeto completo
                    ])
                ).values()
            );

            arDataAsistenciaEmpleados[0].ejb = empleadosUnicos;
            getIO().emit('dashboard_refresh_empleados');
            res.status(200).json({ message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    postRefresAsistenciaEmpleados: (req, res) => {
        const { property } = req.body;

        try {
            const response = [];
            for (const key in arDataAsistenciaEmpleados[0]) {
                if (key == property || key == 'ejb') {
                    response.push({ property: key, data: arDataAsistenciaEmpleados[0][key] });
                }
            }


            res.status(200).json({ asistencia: response });
            delete arDataAsistenciaEmpleados[0][property];
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    }
};


const CONFIG = {
    MIN_TOLERANCIA_ENTRADA: 10,
    MIN_BREAK_PERMITIDO: 45,
    MIN_TOLERANCIA_BREAK: 5,
    HORAS_LABORALES_META: 8
};

// Función maestra para convertir Fecha + Hora en un objeto Date real
const crearFecha = (fechaStr, horaStr) => {
    if (!horaStr || horaStr.includes('--')) return null;
    return new Date(`${fechaStr}T${horaStr}`);
};

const analizarMetricasMadrugada = (dia, horaOficial) => {
    // 1. Creamos fechas base (Día A)
    let dEntrada = crearFecha(dia.fecha, dia.entrada);
    let dSBr = crearFecha(dia.fecha, dia.salidaBreak);
    let dRBr = crearFecha(dia.fecha, dia.retornoBreak);
    let dSalida = crearFecha(dia.fecha, dia.salidaFinal);
    let dOficial = crearFecha(dia.fecha, horaOficial);

    // 2. LÓGICA DE CRUCE DE MEDIANOCHE
    // Si la salida es menor que la entrada, le sumamos 1 día a la salida
    if (dSalida && dEntrada && dSalida < dEntrada) {
        dSalida.setDate(dSalida.getDate() + 1);
    }
    // Lo mismo para el retorno del break si ocurrió de madrugada
    if (dRBr && dSBr && dRBr < dSBr) {
        dRBr.setDate(dRBr.getDate() + 1);
    }

    let minBreak = 0;
    let minTrabajados = 0;

    // Cálculo de Break en milisegundos a minutos
    if (dRBr && dSBr) {
        minBreak = (dRBr - dSBr) / 1000 / 60;
    }

    // Cálculo de Jornada Efectiva
    if (dSalida && dEntrada) {
        const totalMs = dSalida - dEntrada;
        minTrabajados = (totalMs / 1000 / 60) - (minBreak > 0 ? minBreak : 0);
    }

    // Cálculo de Tardanza
    const esTardanza = dEntrada && dOficial
        ? (dEntrada - dOficial) / 1000 / 60 > CONFIG.MIN_TOLERANCIA_ENTRADA
        : false;

    return {
        ...dia,
        tiempoBreak: fmt(minBreak),
        horasEfectivas: fmt(minTrabajados),
        alertas: {
            tardanza: esTardanza,
            excesoBreak: minBreak > (CONFIG.MIN_BREAK_PERMITIDO + CONFIG.MIN_TOLERANCIA_BREAK),
            jornadaIncompleta: (minTrabajados / 60) < CONFIG.HORAS_LABORALES_META
        }
    };
};

const fmt = (min) => {
    if (min <= 0) return "00:00";
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const searchHorarioEmpleado = async (fecha, documento) => {
    try {
        const query = `
            SELECT RH.RANGO_HORA 
            FROM TB_DIAS_TRABAJO DT
            INNER JOIN TB_RANGO_HORA RH ON RH.ID_RANGO_HORA = DT.ID_TRB_RANGO_HORA 
            INNER JOIN TB_DIAS_HORARIO DH ON DH.ID_DIAS = DT.ID_TRB_DIAS 
            WHERE DH.FECHA_NUMBER = ? AND DT.NUMERO_DOCUMENTO = ?
            LIMIT 1;
        `;

        const [rows] = await pool.query(query, [fecha, documento.trim()]);

        if (rows && rows.length > 0) {
            const rangoCompleto = rows[0].RANGO_HORA; // Ejemplo: "08:30 a 17:30"

            // Dividimos por la " a " y tomamos el primer elemento [0]
            // Usamos .trim() por si hay espacios extra alrededor
            const horaEntrada = rangoCompleto.split(' a ')[0].trim();

            return {
                rango: rangoCompleto,
                entradaOficial: horaEntrada // Esto devolverá "08:30"
            };
        }

        return { rango: "", entradaOficial: "08:00" }; // Valor por defecto

    } catch (error) {
        console.error("Error en searchHorarioEmpleado:", error);
        return { rango: "", entradaOficial: "08:00" };
    }
}

// --- PROCESADOR PRINCIPAL ---
const procesarReporteBackend = async (empleados, marcaciones) => {
    console.log("Iniciando procesamiento de", empleados.length, "empleados...");

    // 1. Usamos Promise.all para esperar a que todos los mapas asíncronos terminen
    const reporteCompleto = await Promise.all(empleados.map(async (emp) => {
        const dni = emp.NUMDOC.trim();
        const susMarcaciones = marcaciones.filter(m => m.nroDocumento.trim() === dni);

        // Agrupar por día
        const grupos = susMarcaciones.reduce((acc, curr) => {
            if (!acc[curr.dia]) acc[curr.dia] = [];
            acc[curr.dia].push(curr);
            return acc;
        }, {});

        // 2. Procesamos cada día de forma asíncrona
        const diasProcesados = await Promise.all(Object.keys(grupos).map(async (fecha) => {
            const lista = grupos[fecha].sort((a, b) => a.hrIn.localeCompare(b.hrIn));

            const b1 = lista[0] || null;
            const b2 = lista[1] || null;

            if (!b1) return null; // Saltar si no hay datos

            // IMPORTANTE: Convertir fecha '2026-03-20' a '20260320' para tu FECHA_NUMBER
            const fechaParaDB = fecha.replace(/-/g, '');

            // ESPERAR a la base de datos
            const horarioDB = await searchHorarioEmpleado(fechaParaDB, dni);

            const registro = {
                fecha,
                entrada: b1.hrIn,
                salidaBreak: b1.hrOut || '--:--:--',
                retornoBreak: b2 ? b2.hrIn : '--:--:--',
                salidaFinal: b2 ? b2.hrOut : b1.hrOut,
                entradaOficial: horarioDB.entradaOficial || "08:00",
                rango: horarioDB.rango || "Sin horario"
            };

            // Calcular métricas (Tardanza, Horas, etc.)
            return analizarMetricasMadrugada(registro, registro.entradaOficial);
        }));

        // Limpiar días nulos
        const asistenciaDiaria = diasProcesados.filter(d => d !== null);

        return {
            ...emp,
            NUMDOC: dni,
            asistenciaDiaria
        };
    }));

    return reporteCompleto;
};
