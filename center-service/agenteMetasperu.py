import socketio
import pyodbc
import requests
import json
import pyodbc
import requests
import collections
import os
import time
import threading
from datetime import datetime,timedelta
from getmac import get_mac_address as gma


sio = socketio.Client()

URL_METAS = 'https://api.metasperu.net.pe'
SOCKET_PATH = '/s1/socket/'


res = requests.post(URL_METAS + '/s1/center/api/parameters/store',data={"mac":gma()})
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

    @sio.event
    def py_request_client_blank(data):
        print(f"Dashboard solicita cliente en blanco...")
        myobj = []
        j = {}
        server = instanciaBD
        dataBase = nameBD
        count = extraCliente(data['extra_client'])
        conexion='DRIVER={SQL Server};SERVER='+server+';DATABASE='+dataBase+';UID=ICGAdmin;PWD=masterkey'
        
        querySql="SELECT COUNT(*) FROM CLIENTES WHERE ((NOMBRECLIENTE = '' AND NOMBRECOMERCIAL = '') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'AAAAA') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'aaaaa') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'EEEEE') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'eeeee') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'IIIII') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'iiiii') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'OOOOO') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'ooooo') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'UUUUUU') OR (SUBSTRING(NOMBRECLIENTE,1,5) = 'uuuuu') OR  LOWER(NOMBRECLIENTE) LIKE '%bbbbb%' OR LOWER(NOMBRECLIENTE) LIKE '%ccccc%' OR LOWER(NOMBRECLIENTE) LIKE '%ddddd%' OR LOWER(NOMBRECLIENTE) LIKE '%fffff%' OR LOWER(NOMBRECLIENTE) LIKE '%ggggg%' OR LOWER(NOMBRECLIENTE) LIKE '%hhhhh%' OR LOWER(NOMBRECLIENTE) LIKE '%jjjjj%' OR LOWER(NOMBRECLIENTE) LIKE '%kkkkk%' OR LOWER(NOMBRECLIENTE) LIKE '%lllll%' OR LOWER(NOMBRECLIENTE) LIKE '%mmmmm%' OR LOWER(NOMBRECLIENTE) LIKE '%nnnnn%' OR LOWER(NOMBRECLIENTE) LIKE '%ppppp%' OR LOWER(NOMBRECLIENTE) LIKE '%qqqqq%' OR LOWER(NOMBRECLIENTE) LIKE '%rrrrr%' OR LOWER(NOMBRECLIENTE) LIKE '%sssss%' OR LOWER(NOMBRECLIENTE) LIKE '%ttttt%' OR LOWER(NOMBRECLIENTE) LIKE '%vvvvv%' OR LOWER(NOMBRECLIENTE) LIKE '%wwwww%' OR LOWER(NOMBRECLIENTE) LIKE '%xxxxx%' OR LOWER(NOMBRECLIENTE) LIKE '%yyyyy%' OR LOWER(NOMBRECLIENTE) LIKE '%zzzzz%') AND DESCATALOGADO = 'F';"
        connection = pyodbc.connect(conexion)
        cursor = connection.cursor()
        cursor.execute("SELECT @@version;")
        row = cursor.fetchone()
        cursor.execute(querySql)
        rows = cursor.fetchall()
        for row in rows:
            count += row[0]
            
        obj = collections.OrderedDict()

        obj['clientCant'] = count
        myobj.append(obj)
        clients = json.dumps(myobj)

        sio.emit('py_response_client_blank', {
            'serie': serieTienda,
            'enviar_a': data['pedido_por'],
            'clients': json.loads(clients)[0]['clientCant'] or 0
        })

    @sio.on('py_request_transactions_store')
    def py_requets_transactions_store(data):
        print(f"Dashboard solicita trasacciones en cola...")
        myobj = []
        j = {}
        server = instanciaBD
        dataBase = nameBD
        conexion='DRIVER={SQL Server};SERVER='+server+';DATABASE='+dataBase+';UID=ICGAdmin;PWD=masterkey'
        nowDate=datetime.today().strftime('%Y-%m-%d')
        lastDate = datetime.today()+timedelta(days=-1)
        shift = timedelta(max(1, (lastDate.weekday() + 6) % 7))
        lastDate = lastDate.strftime('%Y-%m-%d')
        querySql="SELECT COUNT(ID) AS ID FROM REM_TRANSACCIONES;"
        connection = pyodbc.connect(conexion)
        cursor = connection.cursor()
        cursor.execute("SELECT @@version;")
        row = cursor.fetchone()
        cursor.execute(querySql)
        rows = cursor.fetchall()
        for row in rows:
            obj = collections.OrderedDict()
            obj['remCount'] = row[0]
            myobj.append(obj)
        transactions = json.dumps(myobj)
        # Respondemos enviando de vuelta el ID de quien preguntó
        sio.emit('py_requets_transactions_store', {
            'serie': serieTienda,
            'enviar_a': data['pedido_por'],
            'transactions': json.loads(transactions)[0]['remCount']
        })

    @sio.on('py_request_documents_store')
    def py_requets_documents_store(data):
        print(f"Dashboard solicita documentos en cola...")

        myobj = []
        j = {}
        server = instanciaBD
        dataBase = nameBD
        conexion='DRIVER={SQL Server};SERVER='+server+';DATABASE='+dataBase+';UID=ICGAdmin;PWD=masterkey'
        
        nowDate=datetime.today().strftime('%Y-%m-%d')
        lastDate = datetime.today()+timedelta(days=-1)
        shift = timedelta(max(1, (lastDate.weekday() + 6) % 7))
        lastDate = lastDate.strftime('%Y-%m-%d')
        querySql="SELECT CASE TIPOSDOC.TIPODOC WHEN '"+codFactura+"' THEN SUBSTRING(CONCAT('F',NUMSERIE),1,len(CONCAT('F',NUMSERIE))-1) WHEN '"+codBoleta+"' THEN SUBSTRING(CONCAT('B',NUMSERIE),1,len(CONCAT('B',NUMSERIE))-1) ELSE SUBSTRING(CONCAT(CONCAT(SUBSTRING(NUMSERIE,4,1),NUMSERIE),NUMSERIE),1,len(NUMSERIE)) END AS NUMSERIE, NUMFACTURA,TIPOSDOC.DESCRIPCION, FORMAT(FECHA,'yyyy-MM-dd') AS FECHA FROM FACTURASVENTA INNER JOIN TIPOSDOC ON TIPOSDOC.TIPODOC = FACTURASVENTA.TIPODOC WHERE FECHA BETWEEN '"+lastDate+"' AND '"+nowDate+"';"
        connection = pyodbc.connect(conexion)
        cursor = connection.cursor()
        cursor.execute("SELECT @@version;")
        row = cursor.fetchone()
        cursor.execute(querySql)
        rows = cursor.fetchall()
        for row in rows:
            obj = collections.OrderedDict()
            obj['cmpSerie'] = row[0]
            obj['cmpNumero'] = row[1]
            obj['cmpTipo'] = row[2]
            obj['cmpFecha'] = row[3]
            myobj.append(obj)
        docs_simulados = json.dumps(myobj)
        # Respondemos enviando de vuelta el ID de quien preguntó
        sio.emit('py_response_documents_store', {
            'serie': serieTienda,
            'enviar_a': data['pedido_por'],
            'documentos': docs_simulados
        })
    
    @sio.event
    def disconnect():
        print("Desconectado del servidor")


    # --- FUNCIÓN DE MONITOREO DE RED ---
    def  task_monitoreo_red():
        while True:
            if sio.connected:
                resultados = []
                for disp in trafficCounters:
                    # 'n' para Windows, 'c' para Linux
                    param = "-n" if os.name == "nt" else "-c"
                    comando = f"ping {param} 1 -w 1000 {disp} > {'nul' if os.name == 'nt' else '/dev/null'}"
                    response = os.system(comando)
                    
                    resultados.append({
                        "nombre": disp,
                        "ip": disp,
                        "online": response == 0
                    })
                
                sio.emit('py_update_devices_status', {
                    'serie': serieTienda,
                    'devices': resultados
                })
            time.sleep(15) # Escanear cada 15 segundos

    def extraCliente(lsCliente):
        server = instanciaBD
        dataBase = nameBD
        count = 0
        conexion='DRIVER={SQL Server};SERVER='+server+';DATABASE='+dataBase+';UID=ICGAdmin;PWD=masterkey'
        
        for cli in lsCliente:
            querySql="SELECT count(*) FROM CLIENTES WHERE NOMBRECLIENTE = '"+cli+"' AND DESCATALOGADO = 'F';"
            connection = pyodbc.connect(conexion)
            cursor = connection.cursor()
            cursor.execute("SELECT @@version;")
            row = cursor.fetchone()
            cursor.execute(querySql)
            rows = cursor.fetchall()
            for row in rows:
                count += row[0]

        return count
    
    if __name__ == '__main__':
        try:
            # Iniciar hilo de monitoreo de red
            threading.Thread(target=task_monitoreo_red, daemon=True).start()
            headers = {"code": serieTienda}
            sio.connect(
            URL_METAS, 
            headers=headers,
            socketio_path=SOCKET_PATH, # <--- IMPORTANTE
            transports=['websocket', 'polling']
            )
            sio.wait()
        except Exception as e:
            print(f"Error: {e}")
