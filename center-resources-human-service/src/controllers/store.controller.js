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

const analizarMetricasMadrugada = (dia, horaOficial) => {
    // 1. Configuración de entrada oficial para tardanza
    let dEntradaPrimera = crearFecha(dia.fecha, dia.entrada);
    let dOficial = crearFecha(dia.fecha, horaOficial);

    let totalMinutosTrabajados = 0;
    let totalMinutosBreak = 0;

    // 2. RECORRER TODOS LOS BLOQUES (Pueden ser 1, 2, 5 o más)
    const bloques = dia.marcaciones || [];
    console.log(bloques[0]['nroDocumento']);
    if(dia.fecha == '2026-03-07' && bloques[0]['documento'] == '70359939'){
        console.log(bloques);
    }

    bloques.forEach((bloque, index) => {
        let inicio = crearFecha(dia.fecha, bloque.hrIn);
        let fin = crearFecha(dia.fecha, bloque.hrOut);

        if (inicio && fin) {
            const msBloque = fin - inicio;
            const minBloque = msBloque / 1000 / 60;
            totalMinutosTrabajados += minBloque;
        }

        // Calcular Break: Es el tiempo entre el fin del bloque actual 
        // y el inicio del siguiente bloque
        if (index < bloques.length - 1) {
            let finBloqueActual = crearFecha(dia.fecha, bloque.hrOut);
            let inicioSiguiente = crearFecha(dia.fecha, bloques[index + 1].hrIn);

            // Ajuste de madrugada para el break
            if (inicioSiguiente < finBloqueActual) {
                inicioSiguiente.setDate(inicioSiguiente.getDate() + 1);
            }

            if (finBloqueActual && inicioSiguiente) {
                const msBreak = inicioSiguiente - finBloqueActual;
                totalMinutosBreak += (msBreak / 1000 / 60);
            }
        }
    });

    // 3. Cálculo de Tardanza (Solo se evalúa la primera entrada del día)
    const minutosTardanza = dEntradaPrimera && dOficial
        ? (dEntradaPrimera - dOficial) / 1000 / 60
        : 0;

    const esTardanza = minutosTardanza > CONFIG.MIN_TOLERANCIA_ENTRADA;

    return {
        ...dia,
        tiempoBreak: fmt(totalMinutosBreak), // Suma de todos los intermedios
        horasEfectivas: fmt(totalMinutosTrabajados), // Suma de todos los bloques laborados
        tardanza: esTardanza,
        minutosTardanza: minutosTardanza > 0 ? minutosTardanza : 0,
        excesoBreak: totalMinutosBreak > (CONFIG.MIN_BREAK_PERMITIDO + CONFIG.MIN_TOLERANCIA_BREAK),
        jornadaIncompleta: (totalMinutosTrabajados / 60) < CONFIG.HORAS_LABORALES_META
    };
};

const fmt = (minutosDecimales) => {
    if (!minutosDecimales || minutosDecimales <= 0) return "00:00";

    // Redondeamos al minuto más cercano para absorber los segundos
    // 418.966 se convertirá en 419
    const minutosRedondeados = Math.round(minutosDecimales);

    const hrs = Math.floor(minutosRedondeados / 60);
    const mins = minutosRedondeados % 60;

    // padStart asegura que siempre veamos 08:05 y no 8:5
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
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

const searchDescansoEmpleado = async (fecha, documento) => {
    try {
        const query = `
            SELECT * 
            FROM TB_DIAS_LIBRE DL
            INNER JOIN TB_DIAS_HORARIO DH ON DH.ID_DIAS = DL.ID_TRB_DIAS
            WHERE DH.FECHA_NUMBER = ? AND DL.NUMERO_DOCUMENTO = ?
            LIMIT 1;
        `;

        const [rows] = await pool.query(query, [fecha, documento.trim()]);

        if (rows && rows.length > 0) {
            const diaDescanso = rows[0].DIA; // Ejemplo: "08:30 a 17:30"

            // Dividimos por la " a " y tomamos el primer elemento [0]
            // Usamos .trim() por si hay espacios extra alrededor

            return {
                descanso: diaDescanso
            };
        }

        return { descanso: "" }; // Valor por defecto

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

    const resultadosPorEmpleado = await Promise.all(empleados.map(async (emp) => {
        const dni = emp.NUMDOC.trim();
        const susMarcaciones = marcaciones.filter(m => m.nroDocumento.trim() === dni);

        if (susMarcaciones.length === 0) return [];

        // 1. Agrupar por día
        const grupos = susMarcaciones.reduce((acc, curr) => {
            if (!acc[curr.dia]) acc[curr.dia] = [];
            // Calculamos horas de este bloque específico
            curr.hrWorking = minutosAHoras(calcularDiferenciaMinutos(curr.hrIn, curr.hrOut));
            acc[curr.dia].push(curr);
            return acc;
        }, {});

        // 2. Procesar cada día dinámicamente
        const asistenciaDiaria = await Promise.all(Object.keys(grupos).map(async (fecha) => {
            // Ordenamos todas las marcaciones del día por hora de inicio
            const lista = grupos[fecha].sort((a, b) => a.hrIn.localeCompare(b.hrIn));
            const totalMarcaciones = lista.length;

            // LÓGICA DINÁMICA:
            const primera = lista[0]; // Siempre la primera del día
            const ultima = lista[totalMarcaciones - 1]; // Siempre la última del día

            const fechaSQL = formatearFechaParaDB(fecha);

            // Consultas a DB en paralelo
            const [horarioDB, papeletaDB, diaDescanso] = await Promise.all([
                searchHorarioEmpleado(fechaSQL, dni),
                searchPapeletaEmpleado(fecha, dni),
                searchDescansoEmpleado(fechaSQL, dni)
            ]);

            // Construimos el registro base
            const registro = {
                documento: dni,
                nombre: primera.nombreCompleto,
                ejb: emp.CODEJB,
                tienda: emp.UNDSERVICIO,
                dia: fecha,
                fecha: fecha,

                // Métrica de visualización
                entrada: primera.hrIn,
                salidaFinal: ultima.hrOut || ultima.hrIn, // Si no tiene salida, usamos la entrada del último bloque

                // Estos campos ahora son informativos del primer y segundo bloque (si existen)
                salidaBreak: totalMarcaciones > 1 ? lista[0].hrOut : '--:--:--',
                retornoBreak: totalMarcaciones > 1 ? lista[1].hrIn : '--:--:--',

                // Datos de Horario/Papeleta
                entradaOficial: horarioDB.entradaOficial || "08:30",
                rango: (diaDescanso.descanso || "").length ? 'Descanso' : (horarioDB.rango || "Sin Horario"),
                codigoPapeleta: papeletaDB.codigoPapeleta || "",
                isPapeleta: !!papeletaDB.isPapeleta,

                // ENVIAMOS TODAS LAS MARCACIONES (las 5 o más)
                // Esto servirá para que en el Dashboard puedas hacer un "Ver más"
                marcaciones: lista,
                totalBloques: totalMarcaciones
            };

            // Aplicamos tu lógica de madrugada y cálculos de horas
            return analizarMetricasMadrugada(registro, registro.entradaOficial);
        }));

        return asistenciaDiaria;
    }));

    return resultadosPorEmpleado.flat();
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
