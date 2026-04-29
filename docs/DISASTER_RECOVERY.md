# Deployment & Disaster Recovery

This document describes step-by-step procedures to recover the Vesting Vault backend when the primary server goes down. It covers database restoration, Kubernetes pod recovery, and Soroban indexer resync.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Restore the PostgreSQL Database](#1-restore-the-postgresql-database)
3. [Restart Kubernetes Pods](#2-restart-kubernetes-pods)
4. [Resync the Soroban Indexer](#3-resync-the-soroban-indexer)
5. [Verify Full Recovery](#4-verify-full-recovery)
6. [Automatic Failover Behaviour](#automatic-failover-behaviour)
7. [Runbook Quick Reference](#runbook-quick-reference)

---

## Prerequisites

Ensure the following are available before starting recovery:

| Requirement | Details |
|---|---|
| `kubectl` access | Configured for the `vesting-vault` namespace |
| AWS CLI | Authenticated with access to the S3 backup bucket |
| `BACKUP_ENCRYPTION_KEY` | Stored in your secrets manager (never in plain text) |
| PostgreSQL client (`psql`) | Version matching the server |
| Soroban RPC endpoint | Horizon or Soroban RPC URL for the target network |

Required environment variables:

```bash
export PG_DB=vestingvault
export PG_USER=postgres
export PG_HOST=<db-host>
export PG_PORT=5432
export PG_PASSWORD=<from-secrets-manager>
export BACKUP_ENCRYPTION_KEY=<from-secrets-manager>
export S3_BUCKET=s3://vestingvault-backups
```

---

## 1. Restore the PostgreSQL Database

### 1.1 List available backups

```bash
aws s3 ls s3://vestingvault-backups/ --recursive | sort | tail -20
```

Backups are named `backup_YYYY-MM-DD_HH-MM-SS.sql.gz.enc`. Choose the most recent one before the incident.

### 1.2 Run the restore script

```bash
# Restore from S3 (recommended)
./scripts/restore.sh s3://vestingvault-backups/backup_YYYY-MM-DD_HH-MM-SS.sql.gz.enc

# Or restore from a local file
./scripts/restore.sh /var/backups/vestingvault/backup_YYYY-MM-DD_HH-MM-SS.sql.gz.enc
```

The script will:
1. Download the encrypted backup from S3 (if an S3 URI is given).
2. Decrypt it using AES-256-CBC with `BACKUP_ENCRYPTION_KEY`.
3. Decompress the gzip archive.
4. Prompt for confirmation before dropping and recreating the database.
5. Restore the SQL dump into a fresh `vestingvault` database.
6. Run a smoke test to confirm public tables exist.

> **Warning:** The restore drops the existing `vestingvault` database. Confirm you are targeting the correct host before proceeding.

### 1.3 Verify the restore

```bash
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

Expected: a non-zero table count. Also spot-check critical tables:

```bash
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
  -c "\dt public.*"
```

---

## 2. Restart Kubernetes Pods

The backend runs as a blue-green deployment in the `vesting-vault` namespace.

### 2.1 Check current pod status

```bash
kubectl get pods -n vesting-vault
kubectl get deployments -n vesting-vault
```

### 2.2 Restart the active deployment

```bash
# Restart whichever deployment is currently active (blue or green)
kubectl rollout restart deployment/vesting-vault-blue -n vesting-vault
# or
kubectl rollout restart deployment/vesting-vault-green -n vesting-vault
```

### 2.3 Watch the rollout

```bash
kubectl rollout status deployment/vesting-vault-blue -n vesting-vault
```

Wait until the output shows `successfully rolled out`.

### 2.4 Confirm pods are healthy

```bash
kubectl get pods -n vesting-vault -w
```

All pods should reach `Running` status with `READY 1/1`. The liveness probe hits `/health` and the readiness probe hits `/health/ready` on port 3000.

### 2.5 Check pod logs for errors

```bash
kubectl logs -n vesting-vault -l app=vesting-vault --tail=100
```

### 2.6 Verify the service endpoint

```bash
kubectl get svc vesting-vault-service -n vesting-vault
# Then test from inside the cluster:
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never -n vesting-vault \
  -- curl -s http://vesting-vault-service/health
```

Expected response: `{"status":"healthy",...}`

### 2.7 Blue-green switch (if needed)

If the active colour needs to be switched after recovery:

```bash
# Point the service selector to the green deployment
kubectl patch svc vesting-vault-service -n vesting-vault \
  -p '{"spec":{"selector":{"app":"vesting-vault","version":"green"}}}'

# Verify
kubectl get svc vesting-vault-service -n vesting-vault -o jsonpath='{.spec.selector}'
```

---

## 3. Resync the Soroban Indexer

The Soroban indexer tracks on-chain vesting events. After a database restore it must be resynced from the last known ledger.

### 3.1 Find the last indexed ledger

```bash
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT MAX(ledger_sequence) FROM soroban_events;"
```

Note this value as `<LAST_LEDGER>`.

### 3.2 Trigger a resync via the indexer job

```bash
# If running as a Kubernetes CronJob / Job:
kubectl create job soroban-resync --from=cronjob/soroban-indexer -n vesting-vault

# Watch the job
kubectl logs -n vesting-vault -l job-name=soroban-resync -f
```

If the indexer is a background service inside the backend pod, restart it:

```bash
kubectl rollout restart deployment/vesting-vault-blue -n vesting-vault
```

The service will automatically resume polling from the last stored ledger sequence on startup.

### 3.3 Verify event ingestion

```bash
# Wait ~60 seconds, then check that new events are being indexed
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT MAX(ledger_sequence), COUNT(*) FROM soroban_events;"
```

The `MAX(ledger_sequence)` should be higher than `<LAST_LEDGER>` once the indexer catches up.

---

## 4. Verify Full Recovery

Run through this checklist before declaring recovery complete:

```bash
# 1. Health endpoint
curl -s https://<your-domain>/health | jq .

# 2. Readiness endpoint
curl -s https://<your-domain>/health/ready | jq .

# 3. Database connectivity (from pod)
kubectl exec -n vesting-vault deploy/vesting-vault-blue -- \
  node -e "const {Pool}=require('pg');const p=new Pool();p.query('SELECT 1').then(()=>{console.log('DB OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"

# 4. Pod count matches desired replicas
kubectl get deployment -n vesting-vault

# 5. No crash-looping pods
kubectl get pods -n vesting-vault | grep -v Running
```

All checks should pass before notifying stakeholders that the system is restored.

---

## Automatic Failover Behaviour

The backend includes an automatic multi-cloud database failover system:

| Event | Behaviour |
|---|---|
| Primary DB unreachable | Detected within **30 seconds** via heartbeat (`SELECT 1` every 10 s) |
| Failover triggered | Traffic switches to secondary (read-only) database |
| During failover | Write operations are blocked; read operations continue |
| Primary DB recovers | Heartbeat detects recovery; read-write mode restored automatically |

No manual intervention is required for transient primary DB outages. Manual steps in this document are for full server loss or data corruption scenarios.

---

## Runbook Quick Reference

| Scenario | Command |
|---|---|
| List S3 backups | `aws s3 ls s3://vestingvault-backups/ \| sort \| tail -20` |
| Restore DB | `./scripts/restore.sh s3://vestingvault-backups/<file>` |
| Restart pods | `kubectl rollout restart deployment/vesting-vault-blue -n vesting-vault` |
| Watch rollout | `kubectl rollout status deployment/vesting-vault-blue -n vesting-vault` |
| Check pod logs | `kubectl logs -n vesting-vault -l app=vesting-vault --tail=100` |
| Health check | `curl https://<domain>/health` |
| Trigger indexer resync | `kubectl create job soroban-resync --from=cronjob/soroban-indexer -n vesting-vault` |
| Switch blue→green | `kubectl patch svc vesting-vault-service -n vesting-vault -p '{"spec":{"selector":{"version":"green"}}}'` |
