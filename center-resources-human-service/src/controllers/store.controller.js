import { getIO } from '../config/socket.js';
import { emailService } from '../services/email.service.js';

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
            arDataAsistenciaEmpleados[0][`${propertyUnique}`] = procesarAsistencia(arDataAsistenciaEmpleados[0][`ejb`], data);
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
        console.log(data);
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
    HORA_ENTRADA_OFICIAL: '08:00:00',
    MIN_TOLERANCIA_ENTRADA: 10,
    MIN_BREAK_PERMITIDO: 45,
    MIN_TOLERANCIA_BREAK: 5,
    HORAS_LABORALES_META: 8
};

const procesarAsistencia = (empleadosRaw, marcacionesRaw) => {

    // 1. Limpiar duplicados de empleados y quitar espacios en NUMDOC
    const empleadosMap = new Map();
    empleadosRaw.forEach(emp => {
        const dni = emp.NUMDOC.trim();
        if (!empleadosMap.has(dni)) {
            empleadosMap.set(dni, { ...emp, NUMDOC: dni });
        }
    });

    const empleadosUnicos = Array.from(empleadosMap.values());

    // 2. Unificar y procesar
    return empleadosUnicos.map(emp => {
        const susMarcaciones = marcacionesRaw.filter(m => m.nroDocumento.trim() === emp.NUMDOC);

        // Agrupar marcaciones por fecha
        const gruposPorDia = susMarcaciones.reduce((acc, curr) => {
            const fecha = curr.dia;
            if (!acc[fecha]) acc[fecha] = [];
            acc[fecha].push(curr);
            return acc;
        }, {});

        const asistenciaDiaria = Object.keys(gruposPorDia).map(fecha => {
            // Ordenar por hora de entrada
            const lista = gruposPorDia[fecha].sort((a, b) => a.hrIn.localeCompare(b.hrIn));

            const b1 = lista[0] || {};
            const b2 = lista[1] || {};

            const registro = {
                fecha,
                entrada: b1.hrIn || '--:--:--',
                salidaBreak: b1.hrOut || '--:--:--',
                retornoBreak: b2.hrIn || '--:--:--',
                salidaFinal: b2.hrOut || '--:--:--'
            };

            return analizarMetricas(registro);
        });

        return {
            ...emp,
            asistenciaDiaria
        };
    });
};

const analizarMetricas = (dia) => {
    const toMin = (h) => {
        if (!h || h.includes('--')) return null;
        const [hrs, mins] = h.split(':').map(Number);
        return (hrs * 60) + mins;
    };

    const mEnt = toMin(dia.entrada);
    const mSBr = toMin(dia.salidaBreak);
    const mRBr = toMin(dia.retornoBreak);
    const mSal = toMin(dia.salidaFinal);
    const mOficial = toMin(CONFIG.HORA_ENTRADA_OFICIAL);

    let minBreak = 0;
    let minTrabajados = 0;

    // Cálculo de Break
    if (mRBr && mSBr) minBreak = mRBr - mSBr;
    const isExcesoBreak = minBreak > (CONFIG.MIN_BREAK_PERMITIDO + CONFIG.MIN_TOLERANCIA_BREAK);

    // Cálculo de Jornada
    if (mSal && mEnt) {
        minTrabajados = (mSal - mEnt) - (minBreak > 0 ? minBreak : 0);
    }
    const isJornadaIncompleta = (minTrabajados / 60) < CONFIG.HORAS_LABORALES_META;

    // Cálculo de Tardanza
    const isTardanza = mEnt && mOficial ? mEnt > (mOficial + CONFIG.MIN_TOLERANCIA_ENTRADA) : false;

    return {
        ...dia,
        tiempoBreak: fmt(minBreak),
        horasEfectivas: fmt(minTrabajados),
        alertas: {
            tardanza: isTardanza,
            excesoBreak: isExcesoBreak,
            jornadaIncompleta: isJornadaIncompleta
        }
    };
};

const fmt = (minutos) => {
    if (minutos <= 0) return '00h 00m';
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
};

// --- FUNCIÓN PARA LEER JSON ---
const cargarJSON = (nombreArchivo) => {
    try {
        const ruta = path.join(__dirname, 'data', nombreArchivo);
        const data = fs.readFileSync(ruta, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error leyendo ${nombreArchivo}:`, error.message);
        return [];
    }
};