CREATE INDEX idx_inv_store_session_id ON inventario_store (cSessionCode, id);
CREATE INDEX idx_inv_store_session_barra ON inventario_store (cSessionCode, cCodigoBarra);
CREATE INDEX idx_inv_store_session_barra2 ON inventario_store (cSessionCode, cCodigoBarra2);
CREATE INDEX idx_inv_store_session_barra3 ON inventario_store (cSessionCode, cCodigoBarra3);

CREATE INDEX idx_escaneos_sesion_id ON inventario_escaneos (sesion_id, id);
CREATE INDEX idx_escaneos_sesion_sku ON inventario_escaneos (sesion_id, sku);
CREATE INDEX idx_escaneos_sesion_seccion ON inventario_escaneos (sesion_id, seccion_id);

CREATE INDEX idx_sesiones_codigo ON inventario_sesiones (codigo_sesion);
