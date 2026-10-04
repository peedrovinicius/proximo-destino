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
                                     '--lock-wait-timeout=60s'], env=pg,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            encrypt = subprocess.Popen(['age', '--recipient', env['BACKUP_AGE_RECIPIENT'],
                                        '--output', str(encrypted)], env=common,
                                       stdin=dump.stdout, stderr=subprocess.DEVNULL)
            dump.stdout.close()
            encrypt_code = encrypt.wait(timeout=600)
            dump_code = dump.wait(timeout=30)
            if encrypt_code or dump_code:
                raise BackupError('Dump or encryption failed; upload refused')
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
