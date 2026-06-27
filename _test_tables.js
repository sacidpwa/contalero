const { execFileSync } = require('child_process');
const fs = require('fs');
const ISQL = 'D:\\Aplicaciones Web\\convertidor fdb\\firebird_embedded\\isql.exe';
const ISQL_DIR = 'D:\\Aplicaciones Web\\convertidor fdb\\firebird_embedded';
const DB = 'D:\\Aplicaciones Web\\convertidor fdb\\COI10EMPRE13 1.FDB';

const sql = `SELECT RDB$RELATION_NAME FROM RDB$RELATIONS
WHERE RDB$SYSTEM_FLAG = 0 AND RDB$RELATION_NAME NOT LIKE '%$%' AND RDB$RELATION_NAME NOT LIKE 'RDB$%'
ORDER BY 1; QUIT;`;

const tmp = __dirname + '\\_t.sql';
fs.writeFileSync(tmp, sql, 'latin1');
const out = execFileSync(ISQL, ['-user','SYSDBA','-password','masterkey','-i',tmp,'-ch','ISO8859_1','-b','-q','-n',DB], {cwd:ISQL_DIR,encoding:'latin1',maxBuffer:800*1024*1024});
fs.unlinkSync(tmp);

const lines = out.split(/\r?\n/).filter(l => {
  const t = l.trim();
  return t && t !== 'RDB$RELATION_NAME' && !/^=+$/.test(t) && !t.startsWith('RDB$');
});
lines.forEach(l => console.log(l.trim()));
