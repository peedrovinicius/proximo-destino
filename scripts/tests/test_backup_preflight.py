import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('preflight', Path(__file__).parents[1] / 'backup-preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightTest(unittest.TestCase):
    def test_missing_settings_are_names_only(self):
        result = preflight.assess({'AWS_SECRET_ACCESS_KEY': 'secret-marker'})
        self.assertFalse(result['configurationValid'])
        self.assertIn('BACKUP_DATABASE_URL', result['missingSettings'])
        self.assertNotIn('secret-marker', json.dumps(result))

    def test_valid_configuration_never_claims_a_real_backup(self):
        env = {
            'BACKUP_DATABASE_URL': 'postgresql://synthetic:secret-marker@db.example.invalid/test?sslmode=require',
            'BACKUP_AGE_RECIPIENT': 'age1' + 'a' * 58,
            'BACKUP_S3_BUCKET': 'synthetic-backup',
            'BACKUP_S3_ENDPOINT': 'https://storage.example.invalid',
            'AWS_ACCESS_KEY_ID': 'synthetic', 'AWS_SECRET_ACCESS_KEY': 'secret-marker',
            'BACKUP_KEY_VERSION': 'synthetic-v1',
        }
        result = preflight.assess(env)
        self.assertTrue(result['configurationValid'])
        self.assertFalse(result['recoveryPointVerified'])
        self.assertNotIn('secret-marker', json.dumps(result))
        env['BACKUP_DATABASE_URL'] = 'postgresql://synthetic:secret-marker@db.example.invalid/test?sslmode=disable'
        self.assertFalse(preflight.assess(env)['configurationValid'])


if __name__ == '__main__':
    unittest.main()
