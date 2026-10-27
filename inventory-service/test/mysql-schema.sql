-- Minimal InnoDB schema for isolated integration tests; not a production schema migration.
CREATE TABLE usuarios (id BIGINT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL,
 password VARCHAR(255) NOT NULL, perfilname VARCHAR(255), role VARCHAR(30), estado INT DEFAULT 1) ENGINE=InnoDB;
CREATE TABLE tiendas (id BIGINT AUTO_INCREMENT PRIMARY KEY, serie VARCHAR(32) UNIQUE, estado VARCHAR(20)) ENGINE=InnoDB;
CREATE TABLE secciones_escaneos (seccion_id BIGINT AUTO_INCREMENT PRIMARY KEY, nombre_seccion VARCHAR(255)) ENGINE=InnoDB;
CREATE TABLE inventario_sesiones (id BIGINT AUTO_INCREMENT PRIMARY KEY, codigo_sesion VARCHAR(6) NOT NULL,
 tienda_id BIGINT, estado VARCHAR(20), creado_por BIGINT, inventario_registrado INT DEFAULT 0) ENGINE=InnoDB;
CREATE TABLE secciones_asginados (id BIGINT AUTO_INCREMENT PRIMARY KEY, codigo_sesion VARCHAR(6), seccion_id_fk BIGINT, nombre_seccion VARCHAR(255)) ENGINE=InnoDB;
CREATE TABLE inventario_escaneos (id BIGINT AUTO_INCREMENT PRIMARY KEY, sesion_id BIGINT, sku VARCHAR(255), cantidad BIGINT,
 escaneado_por BIGINT, fecha_escaneo DATETIME DEFAULT CURRENT_TIMESTAMP, seccion_id BIGINT) ENGINE=InnoDB;
CREATE TABLE inventario_store (id BIGINT AUTO_INCREMENT PRIMARY KEY, cSessionCode VARCHAR(6), codigo_sesion VARCHAR(6),
 cCodigoTienda VARCHAR(32), cCodigoArticulo VARCHAR(255), cReferencia VARCHAR(255), cCodigoBarra VARCHAR(255), cDescripcion VARCHAR(255),
 cDepartamento VARCHAR(255), cSeccion VARCHAR(255), cFamilia VARCHAR(255), cSubFamilia VARCHAR(255), cTalla VARCHAR(255), cColor VARCHAR(255),
 cStock DECIMAL(16,3), cTemporada VARCHAR(255), cConteo BIGINT DEFAULT 0, cTotalConteo DECIMAL(16,3) DEFAULT 0, cEsencia VARCHAR(255),
 cStyleDescription VARCHAR(255), cCodigoBarra2 VARCHAR(255), cCodigoBarra3 VARCHAR(255), checking INT DEFAULT 0) ENGINE=InnoDB;
