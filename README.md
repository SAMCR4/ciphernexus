# Ultra Chat — Zero-Knowledge (Full Project)

This project is the modular version of the ULTRA Chat zero-knowledge app.
It includes:
- crypto module (Argon2 + HKDF + AES-GCM)
- storage module (Supabase integration using your provided project)
- webrtc module (encrypted SDP/ICE & datachannels)
- ui module (snapping windows, encrypted layout storage)
- fileTransfer module (chunked encrypted transfer via datachannel with Supabase fallback)
- Vite dev + build setup

## Quick start (dev)

1. Install dependencies:
```
npm install
```
2. Run dev server:
```
npm run dev
```
3. Open http://localhost:5173

## Build
```
npm run build
```

## Supabase
This project expects a Supabase project. The URL and anon key are already prefilled in the project files.
SQL schema required (create in Supabase SQL editor):
```
create table rooms (id text primary key, owner_id text, created_at timestamptz default now());
create table users (id text, room text, name text, admin boolean default false, kicked boolean default false, primary key (id, room));
create table signals (id bigserial primary key, room text not null, payload text not null, created_at timestamptz default now());
create table messages (id bigserial primary key, room text not null, payload text not null, created_at timestamptz default now());
create table layouts (id bigserial primary key, room text not null, payload text not null, created_at timestamptz default now());
create table file_chunks (id bigserial primary key, room text not null, file_id text not null, seq int not null, payload text not null, created_at timestamptz default now());
```

## RLS Policies (suggested quick-start - testing only)

-- Allow open access for testing (NOT for production)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_rooms" ON public.rooms FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_users" ON public.users FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_signals" ON public.signals FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_messages" ON public.messages FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_layouts" ON public.layouts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.file_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_file_chunks" ON public.file_chunks FOR ALL USING (true) WITH CHECK (true);

# Theme Engine
The UI supports 5 themes (NeoMatrix default). Admins can change the theme using the Admin Panel; changes are encrypted and saved to the layouts table so new clients inherit the theme securely.
