import socketio
import pyodbc
import requests
import json
import pyodbc
import requests
import collections
from datetime import datetime,timedelta

sio = socketio.Client()

URL_METAS = 'https://api.metasperu.net.pe'
SOCKET_PATH = '/s1/socket/'

arConexionSQL = [
        {
            "cntCosto" : "BBW",
            "cdnConexion" : "DRIVER={SQL Server};SERVER=PEBKICG\\PEICG;DATABASE=PERUBK;UID=ICGAdmin;PWD=masterkey"
        },
                {
            "cntCosto" : "VS",
            "cdnConexion" : "DRIVER={SQL Server};SERVER=PEBKICG\\PEICG;DATABASE=PEVSBABK;UID=ICGAdmin;PWD=masterkey"
        },
        {
            "cntCosto" : "VSFA",
            "cdnConexion" : "DRIVER={SQL Server};SERVER=PEBKICG\\PEICG;DATABASE=PEVSFA;UID=ICGAdmin;PWD=masterkey"
        },
        {
            "cntCosto" : "TUMI",
            "cdnConexion" : "DRIVER={SQL Server};SERVER=PEBKICG\\PEICG;DATABASE=PETUMI;UID=ICGAdmin;PWD=masterkey"
        }
]

@sio.event
def connect():
    print("Conectado al servidor central")
    sio.emit('registrar_servidor', {
        'id_servidor': 'servidor_backup'
    })
    
@sio.on('py_request_documents_server')
def on_request():
    print(f"Dashboard solicita documentos en cola...")
    myobj = []
    j = {}
    server = 'PEBKICG\\PEICG'
    dataBase = 'COE_DATA'
    conexion='DRIVER={SQL Server};SERVER='+server+';DATABASE='+dataBase+';UID=ICGAdmin;PWD=masterkey'
    nowDate=datetime.today().strftime('%Y-%m-%d')
    lastDate = datetime.today()+timedelta(days=-1)
    shift = timedelta(max(1, (lastDate.weekday() + 6) % 7))
    lastDate = lastDate.strftime('%Y-%m-%d')
    querySql="SELECT * FROM VIEW_COMPROBANTES WHERE FECHA BETWEEN '"+lastDate+"' AND '"+nowDate+"';"
    connection = pyodbc.connect(conexion)
    cursor = connection.cursor()
    cursor.execute("SELECT @@version;")
    row = cursor.fetchone()
    cursor.execute(querySql)
    rows = cursor.fetchall()
    for row in rows:
        obj = collections.OrderedDict()
        obj['cmpNumero'] = row[0]
        obj['cmpFecha'] = row[1]
        myobj.append(obj)
    docs_simulados = json.dumps(myobj)
    print(docs_simulados)
    # Respondemos enviando de vuelta el ID de quien preguntó
    sio.emit('py_response_documents_server', {
        'documentos': docs_simulados
    })

@sio.event
def disconnect():
    print("Desconectado del servidor")

if __name__ == '__main__':
    try:
        headers = {"code": 'servidorBackup'}
        sio.connect(
        URL_METAS, 
        headers=headers,
        socketio_path=SOCKET_PATH, # <--- IMPORTANTE
        transports=['websocket', 'polling']
        )
        sio.wait()
    except Exception as e:
        print(f"Error: {e}")