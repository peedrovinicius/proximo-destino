#!/usr/bin/env python3
"""Read-only PostgreSQL dump, age encryption, and verified S3 upload.

Only encrypted bytes reach disk/storage. Never prints child stderr or secrets.
"""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import uuid4


class BackupError(Exception):
    pass


# --enable-row-security must never silently turn a full backup into a partial one.
# Require explicit unrestricted SELECT policies and refuse privileged credentials.
ACCESS_CHECK = """
WITH role AS (SELECT * FROM pg_roles WHERE rolname=current_user),
tables AS (
 SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
)
SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
 AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
 AND NOT has_database_privilege(current_database(),'CREATE')
 AND EXISTS (SELECT 1 FROM tables)
 AND NOT EXISTS (
  SELECT 1 FROM tables t WHERE
   NOT has_table_privilege(t.oid,'SELECT')
   OR has_table_privilege(t.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR (t.relrowsecurity AND (
    NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=t.oid
      AND p.polpermissive AND p.polcmd IN ('r','*')
      AND (r.oid=ANY(p.polroles) OR 0=ANY(p.polroles))
      AND pg_get_expr(p.polqual,p.polrelid)='true')
    OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=t.oid
      AND NOT p.polpermissive AND p.polcmd IN ('r','*')
      AND (r.oid=ANY(p.polroles) OR 0=ANY(p.polroles)))
   ))
 )
 AND NOT EXISTS (
  SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_'
   AND n.nspname <> 'information_schema' AND has_schema_privilege(n.oid,'CREATE')
 )
 AND NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
   AND (NOT has_sequence_privilege(c.oid,'SELECT')
        OR has_sequence_privilege(c.oid,'USAGE,UPDATE'))
 )
 AND NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
   AND has_function_privilege(p.oid,'EXECUTE')
 )
FROM role r;
"""


def verify_database_access(pg):
    try:
        result = subprocess.run(
            ['psql', '--no-psqlrc', '--no-password', '--tuples-only', '--no-align',
             '--set=ON_ERROR_STOP=1', '--command', ACCESS_CHECK],
            env=pg, check=True, timeout=60, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True)
    except (OSError, subprocess.SubprocessError):
        raise BackupError('Database access verification failed; upload refused') from None
    if result.stdout.strip() != 't':
        raise BackupError('Database role is privileged or full read access is missing; upload refused')


def configuration(env):
    required = ('BACKUP_DATABASE_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_S3_BUCKET',
                'BACKUP_S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
                'BACKUP_KEY_VERSION')
    if any(not env.get(key, '').strip() for key in required):
        raise BackupError('Missing backup configuration')
    try:
        url = urlsplit(env['BACKUP_DATABASE_URL'])
        port = url.port or 5432
        query = parse_qs(url.query)
        ssl = query.get('sslmode', [''])[0]
        if (url.scheme not in ('postgres', 'postgresql') or not url.hostname
                or '-pooler' in url.hostname or not url.username or not url.password
                or not url.path.strip('/') or url.fragment
                or ssl not in ('require', 'verify-ca', 'verify-full')):
            raise ValueError()
        endpoint = urlsplit(env['BACKUP_S3_ENDPOINT'])
        if (endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username
                or endpoint.password or endpoint.query or endpoint.fragment):
            raise ValueError()
        if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', env['BACKUP_S3_BUCKET']):
            raise ValueError()
        if not re.fullmatch(r'age1[0-9a-z]{58}', env['BACKUP_AGE_RECIPIENT']):
            raise ValueError()
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', env['BACKUP_KEY_VERSION']):
            raise ValueError()
    except ValueError:
        raise BackupError('Invalid backup configuration') from None
    # Build an allowlisted environment: DB password never appears in process args.
    common = {key: env[key] for key in ('PATH', 'HOME', 'TMPDIR') if key in env}
    pg = dict(common, PGHOST=url.hostname, PGPORT=str(port),
              PGUSER=unquote(url.username), PGPASSWORD=unquote(url.password),
              PGDATABASE=unquote(url.path[1:]), PGSSLMODE=ssl,
              PGCONNECT_TIMEOUT='30', PGOPTIONS='-c default_transaction_read_only=on')
    aws = dict(common, AWS_ACCESS_KEY_ID=env['AWS_ACCESS_KEY_ID'],
               AWS_SECRET_ACCESS_KEY=env['AWS_SECRET_ACCESS_KEY'],
               AWS_DEFAULT_REGION=(env.get('AWS_DEFAULT_REGION') or 'us-east-1'),
               AWS_EC2_METADATA_DISABLED='true', AWS_PAGER='')
    if env.get('AWS_SESSION_TOKEN'):
        aws['AWS_SESSION_TOKEN'] = env['AWS_SESSION_TOKEN']
    return pg, aws, common


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def run_backup(env):
    pg, aws, common = configuration(env)
    verify_database_access(pg)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    key = f'proximo-destino/{stamp}-{uuid4().hex}.dump.age'
    with tempfile.TemporaryDirectory(prefix='proximo-backup-') as temp:
        encrypted = Path(temp) / 'backup.dump.age'
        received = Path(temp) / 'received.dump.age'
        dump = None
        encrypt = None
        try:
            # The custom archive (including grants/policies) is never written in cleartext.
            dump = subprocess.Popen(['pg_dump', '--format=custom', '--no-password',
                                     '--enable-row-security', '--lock-wait-timeout=60s'], env=pg,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            encrypt = subprocess.Popen(['age', '--recipient', env['BACKUP_AGE_RECIPIENT'],
                                        '--output', str(encrypted)], env=common,
                                       stdin=dump.stdout, stderr=subprocess.DEVNULL)
            dump.stdout.close()
            encrypt_code = encrypt.wait(timeout=600)
            dump_code = dump.wait(timeout=30)
            if encrypt_code or dump_code:
                raise BackupError('Dump or encryption failed; upload refused')
            verify_database_access(pg)
            if not encrypted.exists() or encrypted.stat().st_size < 100:
                raise BackupError('Encrypted archive is empty')
            with encrypted.open('rb') as stream:
                if stream.read(22) != b'age-encryption.org/v1\n':
                    raise BackupError('Encrypted archive header is invalid')
            sha = digest(encrypted)
            target = f"s3://{env['BACKUP_S3_BUCKET']}/{key}"
            base = ['aws', '--endpoint-url', env['BACKUP_S3_ENDPOINT']]
            subprocess.run(base + ['s3', 'cp', str(encrypted), target, '--only-show-errors',
                            '--metadata', f"sha256={sha},key-version={env['BACKUP_KEY_VERSION']}"],
                           env=aws, check=True, timeout=600, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
            subprocess.run(base + ['s3', 'cp', target, str(received), '--only-show-errors'],
                           env=aws, check=True, timeout=600, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
            if digest(received) != sha:
                raise BackupError('Stored archive verification failed')
            # Hash and key are safe identifiers; do not log URLs/credentials/data.
            print(f'Backup stored and verified: {key} sha256={sha}')
            return key
        except (OSError, subprocess.SubprocessError):
            raise BackupError('Backup command failed; consult configuration and retry') from None
        finally:
            for child in (encrypt, dump):
                if child is not None and child.poll() is None:
                    child.kill()
                    child.wait()


if __name__ == '__main__':
    os.umask(0o077)
    try:
        run_backup(os.environ)
    except BackupError as error:
        print(f'Backup failed: {error}', file=sys.stderr)
        sys.exit(1)
