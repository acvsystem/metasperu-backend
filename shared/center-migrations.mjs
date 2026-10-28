import { readFile } from 'node:fs/promises';

// Run with one dedicated connection: MySQL advisory locks belong to that connection.
export async function migrateCenter(connection) {
  const [[lock]]=await connection.execute("SELECT GET_LOCK('center_schema_v1',30) AS locked");
  if(Number(lock?.locked)!==1)throw new Error('Otra migracion de Center sigue activa.');
  try {
    const [tables]=await connection.execute(`SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME IN ('tb_login','tb_head_traspasos','tb_rrweb_sessions','tb_rrweb_event_batches')`);
    const names=new Set(tables.map(row=>row.TABLE_NAME));
    if(names.has('tb_login')) {
      const [duplicates]=await connection.execute('SELECT USUARIO FROM tb_login GROUP BY USUARIO HAVING COUNT(*)>1 LIMIT 1');
      if(duplicates.length)throw new Error('Existen usuarios duplicados; resolverlos antes de migrar.');
    }
    if(names.has('tb_head_traspasos')) {
      const [duplicates]=await connection.execute('SELECT CODIGO_TRASPASO FROM tb_head_traspasos GROUP BY CODIGO_TRASPASO HAVING COUNT(*)>1 LIMIT 1');
      if(duplicates.length)throw new Error('Existen codigos de traspasos duplicados; resolverlos antes de migrar.');
    }
    if(names.has('tb_rrweb_event_batches')) {
      const [duplicates]=await connection.execute(`SELECT session_id,sequence_number FROM tb_rrweb_event_batches
        GROUP BY session_id,sequence_number HAVING COUNT(*)>1 LIMIT 1`);
      if(duplicates.length)throw new Error('Existen lotes duplicados; resolverlos con una copia revisada antes de migrar. No se ha eliminado informacion.');
    }
    for(const name of ['security.sql','recordings.sql']) {
      const source=await readFile(new URL(`../center-service/sql/${name}`,import.meta.url),'utf8');
      for(const statement of source.replace(/^--.*$/gm,'').split(';').map(sql=>sql.trim()).filter(Boolean)) {
        await connection.query(statement);
      }
    }
    const [columns]=await connection.execute(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.columns
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tb_rrweb_sessions','tb_rrweb_event_batches')`);
    const existing=new Set(columns.map(row=>`${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    if(!existing.has('tb_rrweb_sessions.owner_user_id')) {
      await connection.query('ALTER TABLE tb_rrweb_sessions ADD COLUMN owner_user_id INT NULL');
    }
    if(!existing.has('tb_rrweb_event_batches.payload_hash')) {
      await connection.query('ALTER TABLE tb_rrweb_event_batches ADD COLUMN payload_hash CHAR(64) NULL');
    }
    const [indexes]=await connection.execute(`SELECT TABLE_NAME,INDEX_NAME FROM information_schema.statistics
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tb_rrweb_sessions','tb_rrweb_event_batches')`);
    const keys=new Set(indexes.map(row=>`${row.TABLE_NAME}.${row.INDEX_NAME}`));
    for(const [table,name,definition] of [
      ['tb_rrweb_sessions','idx_rrweb_retention','INDEX idx_rrweb_retention (started_at)'],
      ['tb_rrweb_sessions','idx_rrweb_owner','INDEX idx_rrweb_owner (owner_user_id,started_at)'],
      ['tb_rrweb_event_batches','uq_rrweb_sequence','UNIQUE INDEX uq_rrweb_sequence (session_id,sequence_number)'],
    ])if(!keys.has(`${table}.${name}`))await connection.query(`ALTER TABLE ${table} ADD ${definition}`);
    if(names.has('tb_login')) {
      const [unique]=await connection.execute(`SELECT INDEX_NAME FROM information_schema.statistics
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tb_login' AND COLUMN_NAME='USUARIO'
        AND NON_UNIQUE=0 AND INDEX_NAME='uq_center_username'`);
      if(!unique.length)await connection.query('ALTER TABLE tb_login ADD UNIQUE INDEX uq_center_username (USUARIO)');
    }
    if(names.has('tb_head_traspasos')) {
      const [unique]=await connection.execute(`SELECT INDEX_NAME FROM information_schema.statistics
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tb_head_traspasos' AND INDEX_NAME='uq_center_transfer_code'`);
      if(!unique.length)await connection.query('ALTER TABLE tb_head_traspasos ADD UNIQUE INDEX uq_center_transfer_code (CODIGO_TRASPASO)');
      await connection.query(`INSERT IGNORE INTO tb_center_sequences (sequence_name,current_value)
        SELECT 'transfers',COALESCE(MAX(CAST(SUBSTRING(CODIGO_TRASPASO,2) AS UNSIGNED)),0)
        FROM tb_head_traspasos WHERE CODIGO_TRASPASO REGEXP '^T[0-9]+$'`);
    }
    // Legacy recordings keep NULL ownership. Do not infer an owner from mutable names.
    return {version:1};
  } finally { await connection.execute("SELECT RELEASE_LOCK('center_schema_v1')"); }
}
