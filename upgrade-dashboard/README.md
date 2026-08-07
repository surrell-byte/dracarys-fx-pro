# Live Reports upgrade

This project now exposes the scheduler’s structured data at `GET /api/latest`
on the GCP report server and displays it through the same-origin Vercel route
`/api/live-reports` every minute. The browser never receives the upstream
Basic Auth credentials.

Trade history is stored in the scheduler SQLite database. Each scheduled
daily and weekly report is also saved as a structured snapshot in that same
database, so the app can retrieve it later even after the HTML output has
been rotated. For cloud durability, set `SCHEDULER_DB_PATH` on the GCP host
to a mounted persistent disk, for example:

```sh
SCHEDULER_DB_PATH=/mnt/disks/dracarys-fx/data/signals.db
SCHEDULER_REPORTS_DIR=/mnt/disks/dracarys-fx/reports
```

Do not use an ephemeral container filesystem for either path. Enable regular
GCP Persistent Disk snapshots (or equivalent provider backups) for the disk.

## Deploy

1. On the GCP host, set `REPORTS_USER` and `REPORTS_PASSWORD` in
   `frontend/.env`, then run `setup-gcp-reports-server.sh` followed by
   `setup-gcp-https.sh`.
2. In Vercel, set `REPORTS_API_URL` to `https://YOUR_HOST/api/latest`, plus
   `REPORTS_API_USER` and `REPORTS_API_PASSWORD` to the matching values.
3. Deploy and open **Live Reports** in the sidebar. It includes recent trade
   history and saved daily/weekly reports.

Use `./upgrade-dashboard/verify.sh` before deployment.

`install.sh` verifies the integrated upgrade is complete. `rollback.sh` is
intentionally non-destructive: this source-level change should be reverted
through version control, while scheduler data remains untouched.
