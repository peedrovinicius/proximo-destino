"""Real PostgreSQL 18 rehearsal, enabled only in the disposable CI service."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup_database', Path(__file__).parents[1] / 'backup-external.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


@unittest.skipUnless(os.environ.get('TEST_BACKUP_POSTGRES') == '1', 'Disposable PostgreSQL service required')
class RestrictedDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Refuse to run this fixture against a remote provider or application DB.
        if os.environ.get('PGHOST') != 'postgres' or os.environ.get('PGDATABASE') != 'backup_test':
            raise RuntimeError('Unexpected fixture database')
        cls.owner = dict(os.environ)
        cls.readonly = dict(cls.owner, PGUSER='backup_ci', PGPASSWORD='synthetic-backup-password',
                            PGOPTIONS='-c default_transaction_read_only=on')
        cls.sql("""
CREATE ROLE backup_ci LOGIN PASSWORD 'synthetic-backup-password'
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE TABLE public.protected_rows (id integer PRIMARY KEY, value text);
INSERT INTO public.protected_rows VALUES (1,'synthetic-a'),(2,'synthetic-b');
ALTER TABLE public.protected_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_public ON public.protected_rows USING (false);
CREATE POLICY backup_full_read ON public.protected_rows FOR SELECT TO backup_ci USING (true);
GRANT CONNECT ON DATABASE backup_test TO backup_ci;
GRANT USAGE ON SCHEMA public TO backup_ci;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_ci;
""")

    @classmethod
    def sql(cls, statement, env=None):
        return subprocess.check_output(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                                        '-c', statement], env=env or cls.owner,
                                       stderr=subprocess.DEVNULL, text=True).strip()

    def test_encrypted_backup_storage_and_restore_with_real_dump(self):
        """Integration rehearsal: real PG dump + age + fake storage + PG restore."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            identity = root / 'identity.txt'
            subprocess.run(['age-keygen', '-o', str(identity)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(
                ['age-keygen', '-y', str(identity)], text=True).strip()

            stored = root / 'remote-object.dump.age'
            aws_stub = root / 'aws'
            aws_stub.write_text(f"""#!/usr/bin/env python3
import shutil
import sys
from pathlib import Path
stored = Path({str(stored)!r})
args = sys.argv
idx = args.index('cp')
source, target = args[idx + 1:idx + 3]
if source.startswith('s3://'):
    shutil.copyfile(stored, target)
else:
    shutil.copyfile(source, stored)
""")
            aws_stub.chmod(0o700)
            common = {'PATH': f"{root}:{os.environ['PATH']}"}
            readonly = dict(self.readonly, PATH=common['PATH'])
            fake_aws = dict(common, AWS_ACCESS_KEY_ID='synthetic',
                            AWS_SECRET_ACCESS_KEY='synthetic')
            fake_config = dict(BACKUP_AGE_RECIPIENT=recipient,
                               BACKUP_S3_BUCKET='synthetic-backups',
                               BACKUP_S3_ENDPOINT='https://storage.example',
                               BACKUP_KEY_VERSION='ci-only')

            # The production pipeline runs unmodified. Only its configuration
            # and S3 transport are isolated; pg_dump and age are genuine tools.
            with patch.object(backup, 'configuration',
                              return_value=(readonly, fake_aws, common)):
                with contextlib.redirect_stdout(io.StringIO()):
                    uploaded_key = backup.run_backup(fake_config)

            self.assertTrue(uploaded_key.endswith('.dump.age'))
            self.assertTrue(stored.is_file())
            self.assertTrue(stored.read_bytes().startswith(b'age-encryption.org/v1\n'))
            self.assertNotIn(b'synthetic-a', stored.read_bytes())

            archive = root / 'decrypted-synthetic.dump'
            subprocess.run(['age', '--decrypt', '--identity', str(identity),
                            '--output', str(archive), str(stored)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.assertEqual(archive.open('rb').read(5), b'PGDMP')

            restored_db = 'backup_encrypted_restored'
            self.sql(f'CREATE DATABASE {restored_db}')
            restored_env = dict(self.owner, PGDATABASE=restored_db)
            try:
                subprocess.run(['pg_restore', '--exit-on-error', '--single-transaction',
                                '--no-owner', '--no-privileges',
                                '--dbname', restored_db, str(archive)],
                               env=restored_env, check=True,
                               stderr=subprocess.DEVNULL)
                self.assertEqual(
                    self.sql('SELECT count(*) FROM public.protected_rows', restored_env),
                    '2')
                self.assertEqual(
                    self.sql("SELECT string_agg(value, ',' ORDER BY id) FROM "
                             "public.protected_rows", restored_env),
                    'synthetic-a,synthetic-b')
                self.assertEqual(
                    self.sql("SELECT count(*) FROM pg_policies WHERE schemaname='public' "
                             "AND tablename='protected_rows'", restored_env),
                    '2')
            finally:
                self.sql(f'DROP DATABASE {restored_db}')

    def test_full_rls_dump_restores_all_rows_and_writes_are_denied(self):
        backup.verify_database_access(self.readonly)
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql('DELETE FROM public.protected_rows WHERE false', self.readonly)
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'synthetic.dump'
            subprocess.run(['pg_dump', '--format=custom', '--enable-row-security',
                            '--file', str(archive)], env=self.readonly, check=True,
                           stderr=subprocess.DEVNULL)
            self.sql('CREATE DATABASE backup_restored')
            restored = dict(self.owner, PGDATABASE='backup_restored')
            try:
                subprocess.run(['pg_restore', '--exit-on-error', '--single-transaction',
                                '--no-owner', '--no-privileges', '--dbname', 'backup_restored',
                                str(archive)], env=restored, check=True, stderr=subprocess.DEVNULL)
                self.assertEqual(self.sql('SELECT count(*) FROM public.protected_rows', restored), '2')
                self.assertEqual(self.sql("SELECT string_agg(value, ',' ORDER BY id) FROM public.protected_rows", restored),
                                 'synthetic-a,synthetic-b')
            finally:
                self.sql('DROP DATABASE backup_restored')

    def test_future_table_or_restrictive_policy_or_membership_refuses_backup(self):
        cases = [
            ('CREATE TABLE public.future_table (id integer)', 'DROP TABLE public.future_table'),
            ('CREATE MATERIALIZED VIEW public.future_view AS SELECT 1::integer AS id',
             'DROP MATERIALIZED VIEW public.future_view'),
            ('CREATE TABLE public.owned_future (id integer); '
             'ALTER TABLE public.owned_future OWNER TO backup_ci; '
             'REVOKE ALL ON TABLE public.owned_future FROM backup_ci; '
             'GRANT SELECT ON TABLE public.owned_future TO backup_ci',
             'DROP TABLE public.owned_future'),
            ('CREATE POLICY restrictive_backup ON public.protected_rows AS RESTRICTIVE '
             'FOR SELECT TO backup_ci USING (false)',
             'DROP POLICY restrictive_backup ON public.protected_rows'),
            ('GRANT pg_read_all_data TO backup_ci', 'REVOKE pg_read_all_data FROM backup_ci'),
            ('REVOKE SELECT ON public.protected_rows FROM backup_ci',
             'GRANT SELECT ON public.protected_rows TO backup_ci'),
        ]
        for mutation, cleanup in cases:
            with self.subTest(mutation=mutation):
                self.sql(mutation)
                try:
                    with self.assertRaisesRegex(backup.BackupError, 'upload refused'):
                        backup.verify_database_access(self.readonly)
                finally:
                    self.sql(cleanup)
                backup.verify_database_access(self.readonly)


if __name__ == '__main__':
    unittest.main()
