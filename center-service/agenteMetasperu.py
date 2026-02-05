import socketio
import pyodbc
import requests
from getmac import get_mac_address as gma

sio = socketio.Client()

URL_METAS = 'https://api.metasperu.net.pe'
SOCKET_PATH = '/s1/socket/'


res = requests.post(URL_METAS + '/frontRetail/search/configuration/agente',data={"mac":gma()})
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
        print("Conectado al servidor central")
        sio.emit('tienda_identificarse', {
            'id_tienda': serieTienda,
            'nombre': 'Sucursal Centro'
        })

    @sio.on('python_dame_documentos')
    def on_request(data):
        print(f"Dashboard solicita documentos en cola...")

        # AQUÍ: Lógica real para contar archivos o consultar tu BD
        # Ejemplo simulado:
        docs_simulados = [
            {"id": 101, "cliente": "Juan Perez", "monto": 50.50},
            {"id": 102, "cliente": "Maria Lopez", "monto": 120.00}
        ]

        # Respondemos enviando de vuelta el ID de quien preguntó
        sio.emit('python_entrega_documentos', {
            'enviar_a': data['pedido_por'],
            'documentos': docs_simulados
        })

    @sio.event
    def disconnect():
        print("Desconectado del servidor")

    if __name__ == '__main__':
        try:
            sio.connect(
            URL_METAS, 
            socketio_path=SOCKET_PATH, # <--- IMPORTANTE
            transports=['websocket', 'polling']
            )
            sio.wait()
        except Exception as e:
            print(f"Error: {e}")