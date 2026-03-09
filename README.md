# Resourcing - simple CV upload and reporting

This is a minimal Node.js + Express app to upload CVs, filter candidates, and view simple reports.

Quick start

1. Install dependencies:

```bash
cd /Users/shubhavsharma/workspace/Resourcing
npm install
```

2. Start server:

```bash
npm start
```

Open http://localhost:3000

What it includes
- File upload endpoint: `POST /api/upload` (form field `cv` + fields `name, role, skills, seniority`)
- List and filter: `GET /api/candidates`
- Report: `GET /api/report`
- CV download: `GET /cv/:filename`

Persisted files
- Uploaded files are stored under `data/uploads`
- Simple JSON DB at `data/db.json`

Free hosting options (low cost / free tiers):

- Vercel: great for static frontends; can host the `public` site. For the API you'd need a serverless function—works but requires slight refactor.
- Render (free web services): can host this Node app directly (free instance with sleeping). Easy deploy with a GitHub repo.
- Railway: free tier with $5 credits/month shared; simple deploy from GitHub.
- Fly.io: small free allowances; can run the Node process directly.
- Heroku (free dynos discontinued in 2023): not recommended unless you have a paid plan.

Recommendation
- For minimum friction, push this repo to GitHub and use Render's free web service to deploy the Node server. It supports persistent file storage for small apps and maps environment variables.

Notes & Caveats
- This app uses disk storage (not suitable for multi-instance horizontally scaled deployments). For more robust storage, use S3 or a DB.
- Max upload size is 5MB per file; change in `server.js` if needed.

Supabase Storage integration (recommended)

This project supports uploading CVs to Supabase Storage. If `SUPABASE_URL` and `SUPABASE_KEY` are set, uploads will be stored in the bucket named by `SUPABASE_BUCKET` (default `cvs`) and the app will save a public URL in the candidate metadata.

Required environment variables for production

- `ADMIN_USER` — admin username (e.g., admin)
- `ADMIN_PASS_HASH` — bcrypt hash of the admin password (recommended)
- `SESSION_SECRET` — random secret for sessions
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_KEY` — a service role or key with storage permissions
- `SUPABASE_BUCKET` — bucket name (default `cvs`)

Private buckets and signed URLs

If you set the Supabase bucket to Private (recommended for CVs), the app will not expose public URLs. Instead it will generate a short-lived signed URL when a logged-in user requests a CV.

Environment variable:
- `SIGNED_URL_EXPIRE` — signed URL expiry in seconds (default 300)

Deploy to Render (step-by-step)

1. Push repo to GitHub (already done).
2. Create a Supabase project at https://app.supabase.com, create a Storage bucket called `cvs` (or any name) and note the project URL and service role key.
3. On Render, create a new Web Service and connect your GitHub repo `striker-hash/resourcing-app`.
	- Build command: `npm install`
	- Start command: `npm start`
4. In Render service settings, add the environment variables listed above.
5. Deploy and open your service URL.

Notes about storage and security

- Use `ADMIN_PASS_HASH` rather than plain `ADMIN_PASS`. Create the hash locally with `node hash-password.js "your-password"` and copy it into the env.
- The supplied `SUPABASE_KEY` should ideally be scoped for storage operations; for simplicity you can use the service_role key during development but for production create a restricted key if possible.
- Supabase provides public and signed URLs; this app uses `getPublicUrl` for simplicity. If you need time-limited signed URLs, we can switch to `createSignedUrl`.

