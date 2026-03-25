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

            procesarAsistenciaFinal(arDataAsistenciaEmpleados[0][`ejb`], data).then((asistencia) => {
                arDataAsistenciaEmpleados[0][`${propertyUnique}`] = asistencia;
                getIO().emit('dashboard_refresh_empleados');
            });

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

                    if (key != 'ejb') {
                        // 1. Aplanamos el array de arrays para tener una lista única de objetos
                        const asistenciaPlana = arDataAsistenciaEmpleados[0][key].flat().filter(item => item && item.fecha);

                        // 2. Ordenamos por fecha (de la más antigua a la más reciente)
                        asistenciaPlana.sort((a, b) => {
                            // Convertimos las fechas a objetos Date para una comparación precisa
                            const fechaA = new Date(a.fecha);
                            const fechaB = new Date(b.fecha);

                            // Si las fechas son iguales, podemos ordenar por hora de entrada como segundo criterio
                            if (fechaA.getTime() === fechaB.getTime()) {
                                return a.entrada.localeCompare(b.entrada);
                            }

                            return fechaA - fechaB;
                        });

                        response.push({ property: key, data: asistenciaPlana });
                    } else {
                        response.push({ property: key, data: arDataAsistenciaEmpleados[0][key].flat() });
                    }

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
    MIN_TOLERANCIA_ENTRADA: 0,
    MIN_BREAK_PERMITIDO: 60,
    MIN_TOLERANCIA_BREAK: 0,
    HORAS_LABORALES_META: 8
};

// Función maestra para convertir Fecha + Hora en un objeto Date real
const crearFecha = (fechaStr, horaStr) => {
    if (!horaStr || horaStr.includes('--')) return null;
    return new Date(`${fechaStr}T${horaStr}`);
};

const analizarMetricasLineales = (dia, horaOficial) => {
    // 1. Convertir todas las horas a objetos Date para operar
    // Asumimos que dia.marcaciones es un array: [{hora: "08:00"}, {hora: "10:00"}, ...]
    const marcaciones = dia.marcaciones
        .map(m => crearFecha(dia.fecha, m.hora))
        .sort((a, b) => a - b); // Nos aseguramos que estén en orden cronológico

    let minTrabajados = 0;
    let minBreak = 0;

    // 2. Sumamos bloques de dos en dos (Parejas de Entrada - Salida)
    for (let i = 0; i < marcaciones.length; i += 2) {
        const entradaBloque = marcaciones[i];
        const salidaBloque = marcaciones[i + 1];

        if (entradaBloque && salidaBloque) {
            const diferencia = (salidaBloque - entradaBloque) / 60000;
            minTrabajados += diferencia;
        }
    }

    // 3. El tiempo de "Break" es el tiempo entre bloques
    // (Desde la salida del bloque anterior hasta la entrada del siguiente)
    for (let i = 1; i < marcaciones.length - 1; i += 2) {
        const salidaAnterior = marcaciones[i];
        const entradaSiguiente = marcaciones[i + 1];

        if (salidaAnterior && entradaSiguiente) {
            minBreak += (entradaSiguiente - salidaAnterior) / 60000;
        }
    }

    // 4. Cálculo de Tardanza (Solo con la primera marcación del día)
    const dOficial = crearFecha(dia.fecha, horaOficial);
    const dPrimeraEntrada = marcaciones[0];

    const minTardanza = (dPrimeraEntrada && dOficial)
        ? (dPrimeraEntrada - dOficial) / 60000
        : 0;

    return {
        ...dia,
        totalMarcaciones: marcaciones.length,
        tiempoBreak: fmt(minBreak),
        horasEfectivas: fmt(minTrabajados),
        tardanza: minTardanza > CONFIG.MIN_TOLERANCIA_ENTRADA,
        excesoBreak: minBreak > (CONFIG.MIN_BREAK_PERMITIDO + CONFIG.MIN_TOLERANCIA_BREAK),
        jornadaIncompleta: (minTrabajados / 60) < CONFIG.HORAS_LABORALES_META
    };
};

const fmt = (min) => {
    if (min <= 0) return "00:00";
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};


const searchPapeletaEmpleado = async (fecha, documento) => {
    try {
        const query = `
            SELECT CODIGO_PAPELETA FROM TB_HEAD_PAPELETA 
            WHERE ID_PAP_TIPO_PAPELETA = 7 AND NRO_DOCUMENTO_EMPLEADO = ? AND FECHA_DESDE = ?
        `;

        const [rows] = await pool.query(query, [documento.trim(), fecha]);

        if (rows && rows.length > 0) {
            const rangoCompleto = rows[0].CODIGO_PAPELETA;

            return {
                codigoPapeleta: rangoCompleto || "",
                isPapeleta: rangoCompleto.length > 0 ? true : false
            };
        }

        return { codigoPapeleta: "", isPapeleta: false }; // Valor por defecto

    } catch (error) {
        console.error("Error en searchPapeletaEmpleado:", error);
        return { codigoPapeleta: "", isPapeleta: false };
    }
}


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

const formatearFechaParaDB = (fechaISO) => {
    // fechaISO viene como "2025-01-27"
    const [anio, mes, dia] = fechaISO.split('-');
    // Retornamos "27-1-2025" (quitando ceros a la izquierda del mes/día si es necesario)
    return `${parseInt(dia)}-${parseInt(mes)}-${anio}`;
};

// --- PROCESADOR PRINCIPAL ---
const procesarAsistenciaFinal = async (empleados, marcaciones) => {
    // Usamos Promise.all para manejar la asincronía de la DB
    const resultadosProcesados = await Promise.all(empleados.map(async (emp) => {
        const dni = emp.NUMDOC.trim();

        // 1. Filtrar marcaciones de este empleado
        const susMarcaciones = marcaciones.filter(m => m.nroDocumento.trim() === dni);

        // 2. Agrupar por día
        const grupos = susMarcaciones.reduce((acc, curr) => {
            if (!acc[curr.dia]) acc[curr.dia] = [];
            let minutosTotalesDia = calcularDiferenciaMinutos(curr.hrIn, curr.hrOut);
            curr.hrWorking = minutosAHoras(minutosTotalesDia);
            acc[curr.dia].push(curr);
            return acc;
        }, {});

        // 3. Procesar cada día (esto es lo que consulta a la DB)
        const asistenciaDiaria = await Promise.all(Object.keys(grupos).map(async (fecha) => {
            const lista = grupos[fecha].sort((a, b) => a.hrIn.localeCompare(b.hrIn));

            const b1 = lista[0];
            const b2 = lista[1] || null;

            // Formatear fecha para el query (QUITAR GUIONES: 2026-03-20 -> 20260320)
            const fechaSQL = formatearFechaParaDB(fecha);

            // LLAMADA A LA DB (Asegúrate que searchHorarioEmpleado use await internamente)
            const horarioDB = await searchHorarioEmpleado(fechaSQL, dni);
            const papeletaDB = await searchPapeletaEmpleado(fecha, dni);

            const registro = {
                documento: emp.NUMDOC,
                nombre: b1.nombreCompleto,
                ejb: emp.CODEJB,
                tienda: emp.UNDSERVICIO,
                dia: fecha,
                fecha: fecha,
                entrada: b1.hrIn,
                salidaBreak: b1.hrOut || '--:--:--',
                retornoBreak: b2 ? b2.hrIn : '--:--:--',
                salidaFinal: b2 ? b2.hrOut : b1.hrOut,
                entradaOficial: horarioDB.entradaOficial || "08:30",
                rango: horarioDB.rango || "Sin Horario",
                codigoPapeleta: papeletaDB.codigoPapeleta || "",
                isPapeleta: papeletaDB.isPapeleta ? true : false,
                marcaciones: lista
            };

            // Retornamos el objeto con las métricas calculadas (Tardanza, etc)
            return analizarMetricasLineales(registro, registro.entradaOficial);
        }));

        // 4. RETORNAMOS EL FORMATO QUE NECESITAS
        // Usamos el código de empleado o DNI como "property"
        return asistenciaDiaria;
    }));


    return resultadosProcesados;
};

/**
 * Calcula la diferencia en minutos entre dos horas (HH:mm)
 * Soporta cruce de medianoche (ej: 23:00 a 07:00)
 */
const calcularDiferenciaMinutos = (horaInicio, horaFin) => {
    if (!horaInicio || !horaFin) return 0;

    const [h1, m1] = horaInicio.split(':').map(Number);
    const [h2, m2] = horaFin.split(':').map(Number);

    const inicioEnMinutos = h1 * 60 + m1;
    const finEnMinutos = h2 * 60 + m2;

    let diferencia = finEnMinutos - inicioEnMinutos;

    // Si la diferencia es negativa, significa que pasó a otro día (Cruce de medianoche)
    if (diferencia < 0) {
        diferencia += 24 * 60;
    }

    return diferencia;
};

// Función para convertir minutos a formato legible "HH:mm"
const minutosAHoras = (totalMinutos) => {
    const hrs = Math.floor(totalMinutos / 60);
    const mins = totalMinutos % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};
