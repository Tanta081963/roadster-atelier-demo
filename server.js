require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const {createDatabase}=require("./database");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const DB_FILE = process.env.DATABASE_FILE || "./data/reservations.sqlite";
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && (ADMIN_PASSWORD.length < 16 || SESSION_SECRET.length < 32 || /change-this|replace-with/i.test(ADMIN_PASSWORD + SESSION_SECRET))) {
  console.error("Production requires ADMIN_PASSWORD >= 16 chars and SESSION_SECRET >= 32 chars.");
  process.exit(1);
}
if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.warn("DEVELOPMENT WARNING: Set ADMIN_PASSWORD and SESSION_SECRET in .env before exposing this app to a network.");
}

async function main(){
const db = await createDatabase();
await db.exec(`
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT NOT NULL,
  contact_preference TEXT NOT NULL DEFAULT 'Email',
  configuration TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_email ON reservations(email);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
`);

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use('/api', (req,res,next)=> { res.set('Cache-Control','no-store'); next(); });
app.use('/api/admin', (req,res,next)=> {
  if (!['GET','HEAD'].includes(req.method) && req.get('X-Requested-With') !== 'RoadsterAdmin') return res.status(403).json({error:'Invalid request origin.'});
  if(req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({error:'Cross-site request rejected.'});
  next();
});
const cookieOptions = {httpOnly:true,secure:isProduction,sameSite:'strict',path:'/api/admin',maxAge:8*60*60*1000};
const sessionToken = req => (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('roadster_session='))?.slice(17) || '';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 80, skip: req => req.path === '/health', standardHeaders: true, legacyHeaders: false, message:{error:'Too many requests. Please try again later.'} });
const reservationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many attempts. Please wait and try again later." } });
app.use("/api", apiLimiter);

const configurations = new Set(["Performance", "Thrust", "Rocket"]);
const statuses = new Set(["pending", "reviewing", "confirmed", "cancelled"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nowISO = () => new Date().toISOString();
const clean = (v, max=100) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const hashToken = token => crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

async function adminAuth(req, res, next) {
  const token = sessionToken(req);
  if (!token) return res.status(401).json({ error: "Admin authentication required." });
  const row = await db.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").get(hashToken(token));
  if (!row || row.expires_at < Date.now()) {
    if (row) await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(token));
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
  next();
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "reservation-prototype", time: nowISO() }));

app.post("/api/reservations", reservationLimiter, async (req, res) => {
  const body = req.body || {};
  for (const [field,max] of Object.entries({firstName:60,lastName:60,email:254,country:80,configuration:30})) {
    if (typeof body[field] !== 'string' || body[field].length > max) return res.status(400).json({error:'Invalid or oversized field: '+field});
  }
  // Honeypot field for simple bot screening.
  if (clean(body.website, 200)) return res.status(400).json({ error: "Unable to accept this submission." });

  const firstName = clean(body.firstName, 60);
  const lastName = clean(body.lastName, 60);
  const email = clean(body.email, 254).toLowerCase();
  const country = clean(body.country, 80);
  const contactPreference = clean(body.contactPreference || "Email", 30);
  const configuration = clean(body.configuration, 30);
  const consent = body.demoAcknowledged === true || body.demoAcknowledged === "true";

  if (firstName.length < 1 || lastName.length < 1) return res.status(400).json({ error: "Enter your first and last name." });
  if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!country) return res.status(400).json({ error: "Select your country or region." });
  if (!configurations.has(configuration)) return res.status(400).json({ error: "Choose a valid demo configuration." });
  if (!["Email", "Phone", "No preference"].includes(contactPreference)) return res.status(400).json({ error: "Choose a valid contact preference." });
  if (!consent) return res.status(400).json({ error: "Please acknowledge that this is a demo only." });

  const reference = "RD-" + crypto.randomBytes(12).toString("hex").toUpperCase();
  const now = nowISO();
  try {
    await db.prepare(`INSERT INTO reservations
      (reference, first_name, last_name, email, country, contact_preference, configuration, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(reference, firstName, lastName, email, country, contactPreference, configuration, now, now);
  } catch (err) {
    console.error("Reservation insert failed:", err.message);
    return res.status(500).json({ error: "Could not create the demo reservation. Please try again." });
  }
  res.status(201).json({
    ok: true,
    reservation: { reference, configuration, status: "pending", createdAt: now },
    notice: "Demo record saved to this prototype's database. This is not a real vehicle reservation."
  });
});

app.get("/api/reservations/:reference", async (req, res) => {
  const reference = clean(req.params.reference, 40).toUpperCase();
  const row = await db.prepare(`SELECT reference, configuration, status, created_at
    FROM reservations WHERE reference = ?`).get(reference);
  if (!row) return res.status(404).json({ error: "No demo reservation was found for that reference." });
  res.json({ reservation: { reference: row.reference, configuration: row.configuration, status: row.status, createdAt: row.created_at },
    notice: "Demo status only. This is not a real Tesla reservation." });
});

app.post("/api/admin/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message:{error:'Too many login attempts. Try again in 15 minutes.'} }), async (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  if (!ADMIN_PASSWORD || !SESSION_SECRET || !safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const createdAt = Date.now();
  const expiresAt = createdAt + 8 * 60 * 60 * 1000;
  await db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), createdAt, expiresAt);
  await db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(Date.now());
  res.cookie("roadster_session", token, cookieOptions);
  res.json({ ok: true, expiresAt });
});

app.post("/api/admin/logout", adminAuth, async (req, res) => {
  const token = sessionToken(req);
  res.clearCookie("roadster_session", {...cookieOptions,maxAge:undefined});
  await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(token));
  res.json({ ok: true });
});

app.get("/api/admin/stats", adminAuth, async (req, res) => {
  const total = Number((await db.prepare("SELECT COUNT(*) AS count FROM reservations").get()).count);
  const byStatus = await db.prepare("SELECT status, COUNT(*) AS count FROM reservations GROUP BY status").all();
  const byConfiguration = await db.prepare("SELECT configuration, COUNT(*) AS count FROM reservations GROUP BY configuration").all();
  res.json({ total, byStatus, byConfiguration });
});

app.get('/api/admin/export',adminAuth,async(req,res)=>{
  const records=await db.prepare('SELECT reference, first_name, last_name, email, country, contact_preference, configuration, status, created_at, updated_at FROM reservations ORDER BY created_at').all();
  res.attachment('roadster-reservations.json').json({version:1,exportedAt:nowISO(),reservations:records});
});

app.delete('/api/admin/reservations/:reference', adminAuth, async (req,res)=>{
  const result=await db.prepare('DELETE FROM reservations WHERE reference = ?').run(req.params.reference.toUpperCase());
  if(!result.changes) return res.status(404).json({error:'Reservation not found.'});
  res.json({ok:true});
});

app.get("/api/admin/reservations", adminAuth, async (req, res) => {
  const search = clean(req.query.search, 100);
  const status = clean(req.query.status, 20);
  const config = clean(req.query.configuration, 30);
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
  const where = [];
  const params = [];
  if (search) {
    where.push("(reference LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)");
    const q = `%${search.replace(/[%_]/g, "")}%`;
    params.push(q, q, q, q);
  }
  if (statuses.has(status)) { where.push("status = ?"); params.push(status); }
  if (configurations.has(config)) { where.push("configuration = ?"); params.push(config); }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM reservations ${clause}`).get(...params)).count);
  const rows = await db.prepare(`SELECT reference, first_name AS "firstName", last_name AS "lastName", email, country,
    contact_preference AS "contactPreference", configuration, status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM reservations ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  res.json({ reservations: rows, page, limit, total });
});

app.patch("/api/admin/reservations/:reference", adminAuth, async (req, res) => {
  const reference = clean(req.params.reference, 30).toUpperCase();
  const status = clean(req.body?.status, 20);
  if (!statuses.has(status)) return res.status(400).json({ error: "Invalid status." });
  const result = await db.prepare("UPDATE reservations SET status = ?, updated_at = ? WHERE reference = ?").run(status, nowISO(), reference);
  if (!result.changes) return res.status(404).json({ error: "Reservation not found." });
  res.json({ ok: true, reference, status });
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.use((req,res)=>res.status(404).json({error:"Page or endpoint not found."}));
app.use((err, req, res, next) => {
  console.error(err);
  const status = [400,413].includes(err.status) ? err.status : 500;
  res.status(status).json({ error: status === 400 ? "Invalid request body." : status === 413 ? "Request body too large." : "Unexpected server error." });
});

const server = app.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log('Roadster demo listening on port ' + server.address().port));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close(async ()=>{await db.close();process.exit(0);}));

}
main().catch(error=>{console.error("Startup failed:",error.message);process.exit(1);});
