const fs=require('node:fs');
const path=require('node:path');
async function createDatabase(){
 if(process.env.DATABASE_URL){
  const {Pool,types}=require('pg');
  types.setTypeParser(20,value=>Number(value));
  const url=new URL(process.env.DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('DATABASE_URL must be a PostgreSQL URL.');
  // Keep certificate validation enabled, regardless of connection-string defaults.
  url.searchParams.delete('sslmode');url.searchParams.delete('channel_binding');
  const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:4,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
  pool.on('error',error=>console.error('Database pool error:',error.code||'connection error'));
  await pool.query('SELECT 1');
  return {
   exec:sql=>pool.query(sql.replaceAll('INTEGER PRIMARY KEY AUTOINCREMENT','BIGSERIAL PRIMARY KEY')),
   prepare(sql){let index=0;const query=sql.replace(/\?/g,()=>'$'+(++index));return {
    async get(...values){return (await pool.query(query,values)).rows[0];},
    async all(...values){return (await pool.query(query,values)).rows;},
    async run(...values){return {changes:(await pool.query(query,values)).rowCount};}
   };},close:()=>pool.end()
  };
 }
 if(process.env.NODE_ENV==='production' && process.env.ALLOW_PERSISTENT_SQLITE!=='1')throw Error('Production requires DATABASE_URL. SQLite fallback is disabled to prevent data loss on free hosting.');
 const {DatabaseSync}=require('node:sqlite');
 const file=process.env.DATABASE_FILE||'./data/reservations.sqlite';
 fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
 const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
 return db;
}
module.exports={createDatabase};
