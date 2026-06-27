const { execFileSync } = require('child_process');
const fs = require('fs');
const ISQL = 'D:\\Aplicaciones Web\\convertidor fdb\\firebird_embedded\\isql.exe';
const ISQL_DIR = 'D:\\Aplicaciones Web\\convertidor fdb\\firebird_embedded';
const DB = 'D:\\Aplicaciones Web\\convertidor fdb\\COI10EMPRE13 1.FDB';

const tables = ['CCOSTOS', 'CGRUPOS', 'REGPOL', 'DIARIOSAE', 'OPEIET', 'CONCEPTO', 'TIPOSPOL', 'ADMPER', 'FOLIOS', 'CTAS_PRODSERV'];
for (const t of tables) {
  const sql = `SHOW TABLE "${t}"; QUIT;`;
  const tmp = __dirname + '\\_t.sql';
  fs.writeFileSync(tmp, sql, 'latin1');
  try {
    const out = execFileSync(ISQL, ['-user','SYSDBA','-password','masterkey','-i',tmp,'-ch','ISO8859_1','-b','-q','-n',DB], {cwd:ISQL_DIR,encoding:'latin1',maxBuffer:800*1024*1024});
    const cols = out.split(/\r?\n/).filter(l => {
      const t2 = l.trim();
      return t2 && !t2.startsWith('CONSTRAINT') && !t2.startsWith('Primary') && !t2.startsWith('Foreign') && !t2.startsWith('Unique');
    }).map(l => { const m = l.trim().match(/^(\S+)\s+/); return m ? m[1] : null; }).filter(Boolean).filter(c => !c.startsWith('RDB$'));
    console.log(t + ': ' + cols.join(', '));
  } finally { try { fs.unlinkSync(tmp); } catch(e) {} }
}
