import json

# 1. Cargar los archivos JSON
with open('codigos_tienda.json', 'r', encoding='utf-8') as f_tienda, \
     open('codigos_aplicacion.json', 'r', encoding='utf-8') as f_app:
    
    tienda_data = json.load(f_tienda)
    app_data = json.load(f_app)

# 2. Extraer los códigos usando la propiedad 'codigo'
codigos_tienda = {reg['codigo'] for reg in tienda_data if 'codigo' in reg}
codigos_app = {reg['codigo'] for reg in app_data if 'codigo' in reg}

# 3. Encontrar cuáles están en Tienda pero NO en Aplicación
codigos_faltantes = codigos_tienda - codigos_app

# 4. Guardar el resultado ordenado en un archivo de texto
with open('codigos_faltantes_en_app.txt', 'w', encoding='utf-8') as f_out:
    for codigo in sorted(codigos_faltantes):
        f_out.write(f"{codigo}\n")

print(f"✅ ¡Proceso completado con éxito!")
print(f"📊 Códigos totales en Tienda: {len(codigos_tienda)}")
print(f"📊 Códigos totales en Aplicación: {len(codigos_app)}")
print(f"❌ Códigos que están en Tienda pero FALTAN en Aplicación: {len(codigos_faltantes)}")
print(f"💾 La lista completa se ha guardado en: 'codigos_faltantes_en_app.txt'")