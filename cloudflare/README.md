# Notes RinRin cloud storage

This folder contains the optional Cloudflare R2 storage backend.

## Cloudflare setup

1. Create an R2 bucket named `notes-rinrin-storage`.
2. Deploy this Worker using `wrangler.jsonc`.
3. Add a Worker secret named `AUTH_SECRET`.
4. Optionally set `ALLOWED_ORIGIN` to the Notes RinRin site origin while the frontend and storage Worker live on different origins.

The frontend must send `Authorization: Bearer <AUTH_SECRET>` to the storage API. Do not hard-code that secret into the repository.

## API

- `GET /api/files` — list objects.
- `PUT /api/files/<key>` — upload or replace an object.
- `GET /api/files/<key>` — download an object.
- `DELETE /api/files/<key>` — delete an object.

Object keys are provider-neutral. The same keys can later be copied to another S3-compatible provider such as Timeweb S3 or Cloud.ru Object Storage.
