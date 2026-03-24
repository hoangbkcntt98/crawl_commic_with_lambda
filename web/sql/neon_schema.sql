create table if not exists manga_library (
  manga_id text primary key,
  row_type text not null default 'manga',
  title text,
  detail_url text,
  read_url text,
  image_url text,
  slug text,
  storage_name text,
  item_count integer,
  updated_at timestamptz,
  extra jsonb not null default '{}'::jsonb
);

create table if not exists manga_manifest (
  manga_id text primary key,
  title text,
  storage_name text,
  chapters jsonb not null default '[]'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz
);
