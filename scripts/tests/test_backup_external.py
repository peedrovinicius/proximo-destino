import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'backup-external.py'
spec = importlib.util.spec_from_file_location('backup', SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.identity = self.root / 'identity'
        subprocess.run(['age-keygen', '-o', str(self.identity)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        recipient = subprocess.check_output(['age-keygen', '-y', str(self.identity)], text=True).strip()
        # Deterministic fictitious dump source. No real DB or cloud account is used.
        self.payload = b'PGDMP' + b'fictitious-personal-data\n' * 200
        (self.root / 'source').write_bytes(self.payload)
        self.env = dict(os.environ, BACKUP_DATABASE_URL='postgresql://tester:secret@direct.example/db?sslmode=require',
                        BACKUP_AGE_RECIPIENT=recipient, BACKUP_S3_BUCKET='test-backups',
                        BACKUP_S3_ENDPOINT='https://storage.example', BACKUP_KEY_VERSION='v1',
                        AWS_ACCESS_KEY_ID='fake-access', AWS_SECRET_ACCESS_KEY='fake-secret')
        self.env['PATH'] = f"{self.root}:{os.environ['PATH']}"
        self.write_tool('psql', '#!/bin/sh\nprintf "t\\n"\n')
        self.write_tool('pg_dump', f'''#!/usr/bin/env python3
import sys
from pathlib import Path
sys.stdout.buffer.write(Path({str(self.root / 'source')!r}).read_bytes())
''')
        self.write_tool('aws', f'''#!/usr/bin/env python3
import sys, shutil
from pathlib import Path
root = Path({str(self.root)!r})
args = sys.argv
pos = args.index('cp')
source, target = args[pos+1:pos+3]
if source.startswith('s3://'):
    shutil.copyfile(root / 'stored', target)
else:
    shutil.copyfile(source, root / 'stored')
    (root / 'source-path').write_text(source)
''')

    def write_tool(self, name, text):
        path = self.root / name
        path.write_text(text)
        path.chmod(0o700)

    def execute(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return backup.run_backup(self.env)

    def test_encrypted_roundtrip_and_cleanup(self):
        key = self.execute()
        self.assertTrue(key.endswith('.dump.age'))
        stored = (self.root / 'stored').read_bytes()
        self.assertNotIn(b'fictitious-personal-data', stored)
        plain = subprocess.check_output(['age', '-d', '-i', str(self.identity), str(self.root / 'stored')])
        self.assertEqual(plain, self.payload)
        self.assertFalse(Path((self.root / 'source-path').read_text()).exists())
        _, aws, common = backup.configuration(self.env)
        self.assertNotIn('PGPASSWORD', aws)
        self.assertNotIn('BACKUP_DATABASE_URL', common)

    def test_dump_error_refuses_upload(self):
        self.write_tool('pg_dump', '#!/bin/sh\nprintf partial\nexit 1\n')
        with self.assertRaisesRegex(backup.BackupError, 'upload refused'):
            self.execute()
        self.assertFalse((self.root / 'stored').exists())

    def test_bad_recipient_refuses_upload(self):
        self.env['BACKUP_AGE_RECIPIENT'] = 'age1' + 'a' * 58
        with self.assertRaises(backup.BackupError):
            self.execute()
        self.assertFalse((self.root / 'stored').exists())

    def test_storage_error_fails_without_exposing_secrets(self):
        self.write_tool('aws', '#!/bin/sh\necho fake-secret >&2\nexit 1\n')
        with self.assertRaises(backup.BackupError) as caught:
            self.execute()
        self.assertNotIn('fake-secret', str(caught.exception))

    def test_corrupted_download_fails_and_cleans_up(self):
        original = (self.root / 'aws').read_text()
        self.write_tool('aws', original.replace("shutil.copyfile(root / 'stored', target)", "Path(target).write_bytes(b'corrupted')"))
        with self.assertRaisesRegex(backup.BackupError, 'verification failed'):
            self.execute()
        self.assertFalse(Path((self.root / 'source-path').read_text()).exists())

    def test_unsafe_or_missing_configuration_refused_before_commands(self):
        variants = [
            {'BACKUP_DATABASE_URL': 'postgresql://u:p@ep-pooler.neon.tech/db?sslmode=require'},
            {'BACKUP_DATABASE_URL': 'postgresql://u:p@ep.neon.tech/db?sslmode=disable'},
            {'BACKUP_DATABASE_URL': 'not-a-url'},
            {'BACKUP_S3_ENDPOINT': 'http://storage.example'},
            {'BACKUP_S3_ENDPOINT': 'https://u:p@storage.example'},
            {'BACKUP_KEY_VERSION': 'secret,invalid'},
            {'AWS_SECRET_ACCESS_KEY': ''},
        ]
        for variant in variants:
            with self.subTest(variant=list(variant)), patch.object(backup.subprocess, 'Popen') as spawn:
                with self.assertRaises(backup.BackupError):
                    backup.run_backup(dict(self.env, **variant))
                spawn.assert_not_called()


class DatabaseAccessTests(unittest.TestCase):
    def test_incomplete_or_privileged_access_stops_before_dump(self):
        for output in ('f\n', '', 't\nt\n'):
            with self.subTest(output=output), patch.object(backup.subprocess, 'run', return_value=
                    subprocess.CompletedProcess([], 0, stdout=output)), \
                    patch.object(backup.subprocess, 'Popen') as spawn:
                with self.assertRaisesRegex(backup.BackupError, 'upload refused'):
                    backup.verify_database_access({'PGPASSWORD': 'secret'})
                spawn.assert_not_called()

    def test_connection_error_is_redacted(self):
        with patch.object(backup.subprocess, 'run', side_effect=
                subprocess.CalledProcessError(1, ['psql'], stderr='secret')):
            with self.assertRaises(backup.BackupError) as caught:
                backup.verify_database_access({})
        self.assertNotIn('secret', str(caught.exception))

    def test_complete_access_uses_read_only_environment_and_hides_password(self):
        pg = {'PGPASSWORD': 'secret', 'PGOPTIONS': '-c default_transaction_read_only=on'}
        with patch.object(backup.subprocess, 'run', return_value=
                subprocess.CompletedProcess([], 0, stdout='t\n')) as command:
            backup.verify_database_access(pg)
        self.assertEqual(command.call_args.kwargs['env'], pg)
        self.assertNotIn('secret', ' '.join(command.call_args.args[0]))


if __name__ == '__main__':
    unittest.main()
