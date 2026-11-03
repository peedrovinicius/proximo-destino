#!/usr/bin/env python3
"""Offline backup configuration assessment; no database/storage/child access."""
import importlib.util
import json
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location('backup_external', Path(__file__).with_name('backup-external.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

REQUIRED = ('BACKUP_DATABASE_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_S3_BUCKET',
            'BACKUP_S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'BACKUP_KEY_VERSION')


def assess(env):
    missing = [key for key in REQUIRED if not env.get(key, '').strip()]
    valid = False
    if not missing:
        try:
            backup.configuration(env)
            valid = True
        except backup.BackupError:
            pass
    return {
        'configurationValid': valid,
        'missingSettings': missing,
        'recoveryPointVerified': False,
        'remainingEvidence': [
            'Private bucket and retention policy confirmed by owner',
            'Private decryption key kept outside CI/storage and recoverable',
            'Successful encrypted real backup with verified stored digest',
            'Restore into isolated database with integrity and decryption checks',
        ],
    }


if __name__ == '__main__':
    result = assess(os.environ)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['configurationValid'] else 1)
