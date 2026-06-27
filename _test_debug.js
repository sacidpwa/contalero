const { execFileSync } = require('child_process');
const fs = require('fs');
const ISQL = 'D:\\Aplicaciones Web\\convertidor fdb\\firebird_embedded\\isql.exe';
const ISQL_DIR = 'D:\\Aplicaciones Web\\convertidor fdb\\firebird_embedded';
const DB = 'D:\\Aplicaciones Web\\convertidor fdb\\COI10EMPRE13 1.FDB';

// First get columns
let sql = 'SHOW TABLE "CUENTAS22"; QUIT;';
let tmp = __dirname + '\\_t2.sql';
fs.writeFileSync(tmp, sql, 'latin1');
let out = execFileSync(ISQL, ['-user','SYSDBA','-password','masterkey','-i',tmp,'-ch','ISO8859_1','-b','-q','-n',DB], {cwd:ISQL_DIR,encoding:'latin1',maxBuffer:800*1024*1024});
fs.unlinkSync(tmp);
console.log('=== SHOW TABLE OUTPUT ===');
console.log(out);

// Now try querying with CONCAT separator
sql = `SELECT '|||', "NUM_CTA", '|||', "NOMBRE", '|||' FROM "CUENTAS22" ROWS 3; QUIT;`;
tmp = __dirname + '\\_t2.sql';
fs.writeFileSync(tmp, sql, 'latin1');
out = execFileSync(ISQL, ['-user','SYSDBA','-password','masterkey','-i',tmp,'-ch','ISO8859_1','-b','-q','-n',DB], {cwd:ISQL_DIR,encoding:'latin1',maxBuffer:800*1024*1024});
fs.unlinkSync(tmp);
console.log('=== QUERY OUTPUT ===');
console.log(out);
console.log('=== LENGTH:', out.length, '===');
