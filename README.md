# crawl_commic_with_lambda

## Next.js app

Frontend moi nam trong `web/`.

1. Copy `web/.env.example` thanh `web/.env.local`
2. Cai package:
   `cd web && npm.cmd install`
3. Chay local:
   `npm.cmd run dev`
4. Deploy Vercel voi Root Directory = `web`

### Vercel env

Can them cac env server-side sau trong Vercel Project Settings > Environment Variables:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` neu ban dung temporary credentials
- `DATABASE_URL`
- `LAMBDA_FUNCTION_NAME`
- `S3_BUCKET`
- `S3_PREFIX`
- `MANGA_LIBRARY_TABLE`
- `MANGA_MANIFEST_TABLE`
- `BROWSE_URL`
- `BROWSE_SORT`
- `MAX_PAGES`
- `WAIT_SEC`
- `DOWNLOAD_INVOCATION_TYPE`
- `MAX_IMAGES_PER_CHAPTER`
- `NEXT_PUBLIC_S3_PUBLIC_BASE_URL`

Luu y:

- Khong dat prefix `NEXT_PUBLIC_` cho `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
- Cac bien AWS chi duoc dung trong API routes/server code cua Next.js
- `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` la bien public duy nhat de browser doc anh public tu S3
- `DATABASE_URL` la connection string Neon Postgres va duoc dung boi ca Next.js server va Lambda Python

### Flow chinh

- `POST /api/library/sync`: crawl browse list va luu metadata vao Neon Postgres
- `/`: hien list truyen tu database
- `POST /api/manga/[slug]/download`: fan-out tung chapter len Lambda, metadata manifest/progress luu vao Neon Postgres
- `/manga/[slug]`: doc manifest tu database va render anh tu S3
