const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// Simple session-based auth (single role)
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next){
  if(req.session && req.session.user) return next();
  return res.status(401).json({ error: 'unauthenticated' });
}

// Supabase client (expects SUPABASE_URL and SUPABASE_KEY env vars)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'cvs';
let supabase = null;
if(SUPABASE_URL && SUPABASE_KEY){
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Multer config: use memory storage and stream to Supabase
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// In-memory "database" of candidates (persisted to disk in JSON file)
const DB_FILE = path.join(__dirname, 'data', 'db.json');
let db = { candidates: [] };
function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(raw);
  } catch (e) {
    db = { candidates: [] };
    saveDb();
  }
}
function saveDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
loadDb();

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Upload endpoint: metadata fields: name, role, skills (comma separated), seniority
app.post('/api/upload', requireAuth, upload.single('cv'), async (req, res) => {
  const { name, role, skills, seniority } = req.body;
  if (!req.file) return res.status(400).json({ error: 'CV file is required (form field cv)' });

  // create a safe filename
  const ts = Date.now();
  const safe = req.file.originalname.replace(/[^a-zA-Z0-9.\-_/ ]/g, '_');
  const filename = `${ts}_${safe}`;

  let storedPath = null;
  let publicUrl = null;
  if(supabase){
    try{
      // upload to supabase storage
      const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filename, req.file.buffer, { cacheControl: '3600', upsert: false });
      if(error) throw error;
      // store the object path (we will generate signed URLs on download)
      storedPath = data.path;
    }catch(err){
      console.error('Supabase upload error', err.message || err);
      return res.status(500).json({ error: 'failed to upload to storage' });
    }
  } else {
    // fallback: write to local uploads dir
    const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const outPath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(outPath, req.file.buffer);
  publicUrl = `/cv/${filename}`; // local download endpoint still works
  }

  const candidate = {
    id: Date.now().toString(36),
    name: name || 'Unknown',
    role: role || '',
    skills: (skills || '').split(',').map(s => s.trim()).filter(Boolean),
    seniority: seniority || '',
  filename,
  path: storedPath,
  url: publicUrl,
    uploadedAt: new Date().toISOString()
  };
  db.candidates.push(candidate);
  saveDb();
  res.json({ ok: true, candidate });
});

// List candidates with optional filters: role, skill, seniority, name
app.get('/api/candidates', (req, res) => {
  const { role, skill, seniority, name } = req.query;
  let list = db.candidates.slice().reverse(); // newest first
  if (role) list = list.filter(c => c.role.toLowerCase().includes(role.toLowerCase()));
  if (seniority) list = list.filter(c => c.seniority.toLowerCase().includes(seniority.toLowerCase()));
  if (name) list = list.filter(c => c.name.toLowerCase().includes(name.toLowerCase()));
  if (skill) list = list.filter(c => c.skills.map(s => s.toLowerCase()).includes(skill.toLowerCase()));
  res.json({ ok: true, candidates: list });
});

// Simple reporting: counts by role and by seniority
app.get('/api/report', (req, res) => {
  const byRole = {};
  const bySeniority = {};
  db.candidates.forEach(c => {
    byRole[c.role] = (byRole[c.role] || 0) + 1;
    bySeniority[c.seniority] = (bySeniority[c.seniority] || 0) + 1;
  });
  res.json({ ok: true, total: db.candidates.length, byRole, bySeniority });
});

// Download CV file
app.get('/cv/:filename', requireAuth, (req, res) => {
  // try to find candidate by filename and redirect to stored URL
  const candidate = db.candidates.find(c => c.filename === req.params.filename);
  if(candidate && candidate.url){
    // if stored in Supabase (path available), create signed URL
    if(candidate.path && supabase){
      const expires = parseInt(process.env.SIGNED_URL_EXPIRE || '300', 10);
      supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(candidate.path, expires)
        .then(result => {
          if(result.error) return res.status(500).send('failed to create signed url');
          return res.redirect(result.signedURL);
        }).catch(err => { console.error(err); res.status(500).send('error'); });
      return;
    }
    // if url looks like a local path, serve it
    if(candidate.url.startsWith('/cv/')){
      const file = path.join(__dirname, 'data', 'uploads', req.params.filename);
      if (!fs.existsSync(file)) return res.status(404).send('Not found');
      return res.download(file);
    }
    return res.redirect(candidate.url);
  }
  // not found
  res.status(404).send('Not found');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

// Auth endpoints
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH; // prefer hashed password
  const ADMIN_PASS_PLAIN = process.env.ADMIN_PASS; // fallback

  if(!username || !password) return res.status(400).json({ error: 'username & password required' });
  if(username !== ADMIN_USER) return res.status(401).json({ error: 'invalid credentials' });

  if(ADMIN_PASS_HASH){
    // compare bcrypt
    const ok = bcrypt.compareSync(password, ADMIN_PASS_HASH);
    if(ok){ req.session.user = { username }; return res.json({ ok: true }); }
    return res.status(401).json({ error: 'invalid credentials' });
  }

  // fallback to plain-text env var (not recommended)
  if(ADMIN_PASS_PLAIN && password === ADMIN_PASS_PLAIN){ req.session.user = { username }; return res.json({ ok: true }); }
  return res.status(401).json({ error: 'invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => { if(err) return res.status(500).json({ error: 'failed' }); res.json({ ok:true }); });
});
