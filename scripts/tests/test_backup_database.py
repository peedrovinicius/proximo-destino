"""Real PostgreSQL 18 rehearsal, enabled only in the disposable CI service."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

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
