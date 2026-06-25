import pandas as pd

print("⏳ Cargando y unificando inventarios...")

# 1. Cargar el Archivo 1 (Multi Almacén)
try:
    df1 = pd.read_excel('INVENTARIO_MULTIALMACEN.xls')
except Exception:
    df1 = pd.read_excel('INVENTARIO_MULTIALMACEN.xls', engine='openpyxl')

# Asegurar nombres limpios de columnas y tipos de datos
df1['Referencia'] = df1['Referencia'].dropna().astype(str).str.strip()
# Agrupamos por si acaso una referencia esté repetida en múltiples almacenes
df1_clean = df1.groupby('Referencia')['Stock'].sum().reset_index()

# 2. Cargar el Archivo 2 (Aplicación)
df2 = pd.read_excel('INVENTARIO_APLICACION.xlsx')
df2['cReferencia'] = df2['cReferencia'].dropna().astype(str).str.strip()
df2_clean = df2.groupby('cReferencia')['cStock'].sum().reset_index()

# 3. Cruzar los datos (Full Outer Join para no perder ningún código)
df_comparativo = pd.merge(
    df1_clean, 
    df2_clean, 
    left_on='Referencia', 
    right_on='cReferencia', 
    how='outer'
)

# Rellenar códigos faltantes en el cruce
df_comparativo['Referencia'] = df_comparativo['Referencia'].fillna(df_comparativo['cReferencia'])
df_comparativo['Stock'] = df_comparativo['Stock'].fillna(0).astype(int)
df_comparativo['cStock'] = df_comparativo['cStock'].fillna(0).astype(int)

# 4. Calcular la diferencia matemática
# Resultado > 0: Falta stock en la App
# Resultado < 0: Hay más stock en la App que en el almacén físico
df_comparativo['Diferencia'] = df_comparativo['Stock'] - df_comparativo['cStock']

# 5. Agregar una columna de Estado para facilitar filtros
def determinar_estado(row):
    if row['Diferencia'] == 0:
        return 'Correcto'
    elif row['Diferencia'] > 0:
        return 'Falta Stock en App'
    else:
        return 'Exceso en App'

df_comparativo['Estado'] = df_comparativo.apply(determinar_estado, axis=1)

# Limpiar columnas sobrantes y ordenar por mayor diferencia
df_final = df_comparativo[['Referencia', 'Stock', 'cStock', 'Diferencia', 'Estado']]
df_final = df_final.sort_values(by='Diferencia', ascending=False)

# 6. Guardar el resultado final
df_final.to_excel('Diferencias_Stock_Final.xlsx', index=False)

print(f"\n✅ ¡Cruze de {len(df_final)} registros completado!")
print(f"💾 Archivo guardado como: 'Diferencias_Stock_Final.xlsx'")