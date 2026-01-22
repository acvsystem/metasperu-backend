import socketio
import pyodbc
import requests
from getmac import get_mac_address as gma

# Cliente Socket para escuchar la orden
sio = socketio.Client()
API_URL = "https://api.metasperu.net.pe/s3/inventory/response/store"

serverBackend = 'https://api.metasperu.net.pe'
serverSocket = 'wss://api.metasperu.net.pe'
res = requests.post(serverBackend + '/frontRetail/search/configuration/agente',data={"mac":gma()})
configuration = res.json()
print('configuration',configuration)


if len(configuration) > 0:
    parametros = configuration[0]
    serieTienda = parametros['SERIE_TIENDA']
    instanciaBD = parametros['DATABASE_INSTANCE']
    nameBD = parametros['DATABASE_NAME']
    codFactura = parametros['COD_TIPO_FAC']
    codBoleta = parametros['COD_TIPO_BOL']
    propertyStock = parametros['PROPERTY_STOCK']
    nameExcel = parametros['NAME_EXCEL_REPORT_STOCK']
    asuntoEmail = parametros['ASUNTO_EMAIL_REPORT_STOCK']
    trafficCounters = parametros['TRAFFIC_COUNTERS']
    timeClear = parametros['TIME_CLEAR']
    
    @sio.event
    def connect():
        print("Conectado al Socket del Backend Central")
        sio.emit('join_room', {'room': serieTienda})

    @sio.on('orden_enviar_inventario')
    def req_inv_store(dataSession):
        mapping_estilo = {
            '7': 'STYLO_REFERENCIA',
            '9N': 'STYLO', '9D': 'STYLO', '9B': 'STYLO', # ... etc
            '9L': 'STYLE', '9F': 'STYLE'
        }
        campo_estilo = "STYLE" # Default
        for prefix, col in mapping_estilo.items():
            if serieTienda.startswith(prefix):
                campo_estilo = col
                break
        conexion_str = f'DRIVER={{SQL Server}};SERVER={instanciaBD};DATABASE={nameBD};UID=ICGAdmin;PWD=masterkey'
        query_sql = f"""
        SET NOCOUNT ON;
        DECLARE @CODALMACEN AS NVARCHAR(3) = (SELECT TOP 1 VALOR FROM PARAMETROS WHERE CLAVE='ALDEF');
        WITH EstiloObjetivo AS (
            SELECT TOP 1 CL.{campo_estilo} as EstiloID, L.COLOR
            FROM ARTICULOSLIN L
            INNER JOIN ARTICULOSCAMPOSLIBRES CL ON L.CODARTICULO = CL.CODARTICULO
            WHERE L.CODBARRAS = ?
        )
        SELECT 
            A.CODARTICULO, A.REFPROVEEDOR, L.CODBARRAS, A.DESCRIPCION,
            D.DESCRIPCION as DEP, SEC.DESCRIPCION as SEC, F.DESCRIPCION as FAM, 
            SF.DESCRIPCION as SUBFAM, L.TALLA, L.COLOR, S.STOCK, A.TEMPORADA
        FROM ARTICULOS A WITH(NOLOCK)
        INNER JOIN ARTICULOSLIN L WITH(NOLOCK) ON A.CODARTICULO = L.CODARTICULO
        INNER JOIN ARTICULOSCAMPOSLIBRES CL WITH(NOLOCK) ON A.CODARTICULO = CL.CODARTICULO
        LEFT JOIN STOCKS S WITH(NOLOCK) ON L.CODARTICULO = S.CODARTICULO 
                                        AND L.TALLA = S.TALLA 
                                        AND L.COLOR = S.COLOR 
                                        AND S.CODALMACEN = @CODALMACEN
        LEFT JOIN DEPARTAMENTO D WITH(NOLOCK) ON A.DPTO = D.NUMDPTO
        LEFT JOIN SECCIONES SEC WITH(NOLOCK) ON A.DPTO = SEC.NUMDPTO AND A.SECCION = SEC.NUMSECCION
        INNER JOIN EstiloObjetivo EO ON CL.{campo_estilo} = EO.EstiloID AND L.COLOR = EO.COLOR
        WHERE D.NUMDPTO NOT IN ('96', '97') 
          AND A.REFPROVEEDOR NOT LIKE '%-1'
          AND S.STOCK > 0;
        """
        try:
            with pyodbc.connect(conexion_str) as conn:
                cursor = conn.cursor()
                cursor.execute(query_sql)
                rows = cursor.fetchall()

                myobj = [
                    {
                        'cSessionCode': dataSession['session_code'],
                        'cCodigoTienda': serieTienda,
                        'cCodigoArticulo': r[0],
                        'cReferencia': r[1],
                        'cCodigoBarra': r[2],
                        'cDescripcion': r[3],
                        'cDepartamento': r[4],
                        'cSeccion': r[5],
                        'cFamilia': r[6],
                        'cSubFamilia': r[7],
                        'cTalla': r[8],
                        'cColor': r[9],
                        'cStock': float(r[10] or 0),
                        'cTemporada': r[11]
                    } for r in rows
                ]

                requests.post(API_URL, json=myobj)
        except Exception as e:
            print(f" Error crítico en búsqueda avanzada: {e}")

    sio.connect('https://api.metasperu.net.pe/s3/socket/')
    sio.wait()