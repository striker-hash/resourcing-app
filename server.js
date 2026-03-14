const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Config from env
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH; // bcrypt hash

// Azure Blob
const AZURE_CONN = process.env.AZURE_STORAGE_CONNECTION_STRING;
const AZURE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER || 'cvs';
let blobContainer = null;
if (AZURE_CONN) {
  const blobSvc = BlobServiceClient.fromConnectionString(AZURE_CONN);
  blobContainer = blobSvc.getContainerClient(AZURE_CONTAINER);
  (async () => {
    try {
      await blobContainer.createIfNotExists();
      console.log('Azure container ready');
    } catch (e) {
      console.error('azure container init', e.message);
    }
  })();
}

// Postgres
const DATABASE_URL = process.env.DATABASE_URL;
let pg = null;
if (DATABASE_URL) {
  pg = new Pool({ connectionString: DATABASE_URL });
  (async () => {
    const create = `CREATE TABLE IF NOT EXISTS candidates (
      id text PRIMARY KEY,
      name text,
      role text,
      skills text[],
      seniority text,
      referredby text,
      filename text,
      path text,
      uploaded_at timestamptz
    );`;
    try {
      await pg.query(create);
      console.log('Postgres ready');
    } catch (e) {
      console.error('pg init', e.message);
    }
  })();
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function authRequired(req, res, next) {
  const a = req.headers.authorization;
  if (!a) return res.status(401).json({ error: 'missing token' });
  const parts = a.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'bad token' });
  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });
  if (username !== ADMIN_USER) return res.status(401).json({ error: 'invalid credentials' });
  if (!ADMIN_PASS_HASH) return res.status(500).json({ error: 'admin password not configured' });
  const ok = bcrypt.compareSync(password, ADMIN_PASS_HASH);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ ok: true, token });
});

// upload
app.post('/api/upload', authRequired, upload.single('cv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const { name, role, skills, seniority, referredBy } = req.body;
  const ts = Date.now();
  const safe = req.file.originalname.replace(/[^a-zA-Z0-9.\.-_ ]/g, '_');
  const filename = `${ts}_${safe}`;

  let pathInStorage = null;
  if (blobContainer) {
    try {
      const block = blobContainer.getBlockBlobClient(filename);
      await block.uploadData(req.file.buffer, { blobHTTPHeaders: { blobContentType: req.file.mimetype } });
      pathInStorage = filename;
    } catch (e) {
      console.error('azure upload', e.message);
      return res.status(500).json({ error: 'upload failed' });
    }
  } else {
    // local fallback (for development)
    const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);
    pathInStorage = filename;
  }

  const candidate = {
    id: ts.toString(36),
    name: name || 'Unknown',
    role: role || '',
    skills: (skills || '').split(',').map(s => s.trim()).filter(Boolean),
    seniority: seniority || '',
    referredby: referredBy || '',
    filename,
    path: pathInStorage,
    uploaded_at: new Date().toISOString()
  };

  if (pg) {
    const sql = `INSERT INTO candidates(id,name,role,skills,seniority,referredby,filename,path,uploaded_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
    try {
      await pg.query(sql, [candidate.id, candidate.name, candidate.role, candidate.skills, candidate.seniority, candidate.referredby, candidate.filename, candidate.path, candidate.uploaded_at]);
    } catch (e) {
      console.error('pg insert', e.message);
      return res.status(500).json({ error: 'db error' });
    }
  } else {
    // local JSON fallback
    const DB_FILE = path.join(__dirname, 'data', 'db.json');
    let current = { candidates: [] };
    try { current = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { }
    current.candidates = current.candidates || [];
    current.candidates.push(candidate);
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(current, null, 2));
  }

  res.json({ ok: true, candidate });
});

// list
app.get('/api/candidates', authRequired, async (req, res) => {
  const { name, role, skill, seniority, referredBy } = req.query;
  if (pg) {
    const conditions = [];
    const values = [];
    if (name) { values.push(`%${name}%`); conditions.push(`name ILIKE $${values.length}`); }
    if (role) { values.push(`%${role}%`); conditions.push(`role ILIKE $${values.length}`); }
    if (seniority) { values.push(seniority); conditions.push(`seniority = $${values.length}`); }
    if (referredBy) { values.push(`%${referredBy}%`); conditions.push(`referredby ILIKE $${values.length}`); }
    if (skill) { values.push(`%${skill}%`); conditions.push(`array_to_string(skills, ',') ILIKE $${values.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const q = `SELECT * FROM candidates ${where} ORDER BY uploaded_at DESC`;
    try { const r = await pg.query(q, values); return res.json({ ok: true, candidates: r.rows }); } catch (e) { console.error('pg select', e.message); return res.status(500).json({ error: 'db' }); }
  }
  const DB_FILE = path.join(__dirname, 'data', 'db.json');
  try {
    const current = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    let candidates = (current.candidates || []).slice().reverse();
    if (name) candidates = candidates.filter(c => c.name.toLowerCase().includes(name.toLowerCase()));
    if (role) candidates = candidates.filter(c => c.role.toLowerCase().includes(role.toLowerCase()));
    if (seniority) candidates = candidates.filter(c => c.seniority === seniority);
    if (referredBy) candidates = candidates.filter(c => (c.referredby || '').toLowerCase().includes(referredBy.toLowerCase()));
    if (skill) candidates = candidates.filter(c => c.skills.some(s => s.toLowerCase().includes(skill.toLowerCase())));
    return res.json({ ok: true, candidates });
  } catch (e) { return res.json({ ok: true, candidates: [] }); }
});

// download
app.get('/cv/:filename', authRequired, async (req, res) => {
  const filename = req.params.filename;
  // find entry
  let entry = null;
  if (pg) {
    try { const r = await pg.query('SELECT * FROM candidates WHERE filename=$1', [filename]); if (r.rows.length) entry = r.rows[0]; } catch (e) { console.error('pg find', e.message); }
  } else {
    try { const current = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'db.json'), 'utf8')); entry = (current.candidates || []).find(c => c.filename === filename); } catch (e) { }
  }
  if (!entry) return res.status(404).send('Not found');

  if (blobContainer) {
    try {
      const blob = blobContainer.getBlobClient(entry.path);
      const expiry = new Date();
      expiry.setSeconds(expiry.getSeconds() + (parseInt(process.env.SIGNED_URL_EXPIRE) || 300));
      const sasUrl = await blob.generateSasUrl({
        permissions: BlobSASPermissions.parse('r'),
        expiresOn: expiry,
      });
      return res.json({ ok: true, url: sasUrl });
    } catch (e) { console.error('azure get', e.message); return res.status(500).send('error'); }
  }
  // local fallback
  const file = path.join(__dirname, 'data', 'uploads', filename);
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  return res.download(file);
});

// delete
app.delete('/api/candidates/:id', authRequired, async (req, res) => {
  const id = req.params.id;
  if (pg) {
    try { await pg.query('DELETE FROM candidates WHERE id=$1', [id]); return res.json({ ok: true }); } catch (e) { console.error('pg del', e.message); return res.status(500).json({ error: 'db' }); }
  }
  const DB_FILE = path.join(__dirname, 'data', 'db.json');
  try { const current = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); current.candidates = (current.candidates || []).filter(c => c.id !== id); fs.writeFileSync(DB_FILE, JSON.stringify(current, null, 2)); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ error: 'err' }); }
});

// report
app.get('/api/report', authRequired, async (req, res) => {
  if (pg) {
    try { const r = await pg.query('SELECT role, seniority, COUNT(*) as cnt FROM candidates GROUP BY role, seniority');
      const byRole = {}; const bySeniority = {}; let total = 0;
      r.rows.forEach(row => { byRole[row.role] = (byRole[row.role] || 0) + parseInt(row.cnt); bySeniority[row.seniority] = (bySeniority[row.seniority] || 0) + parseInt(row.cnt); total += parseInt(row.cnt); });
      return res.json({ ok: true, total, byRole, bySeniority });
    } catch (e) { console.error('pg report', e.message); return res.status(500).json({ error: 'db' }); }
  }
  const DB_FILE = path.join(__dirname, 'data', 'db.json');
  try { const current = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); const byRole = {}; const bySeniority = {}; (current.candidates || []).forEach(c => { byRole[c.role] = (byRole[c.role] || 0) + 1; bySeniority[c.seniority] = (bySeniority[c.seniority] || 0) + 1; }); return res.json({ ok: true, total: (current.candidates || []).length, byRole, bySeniority }); } catch (e) { return res.json({ ok: true, total: 0, byRole: {}, bySeniority: {} }); }
});

app.listen(PORT, () => console.log('Server listening on', PORT));
