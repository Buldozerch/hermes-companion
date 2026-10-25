"""Exercise private account file operations in a local temporary directory."""

import ast
import os
import secrets
import stat
import tempfile
import json
import unittest
from pathlib import Path

source = ast.parse(Path('src/scripts/configure-user.py').read_text())
functions = ast.Module(body=[node for node in source.body if isinstance(node, ast.FunctionDef)], type_ignores=[])
namespace = {'os': os, 'secrets': secrets, 'json': json}
exec(compile(functions, 'configure-user.py', 'exec'), namespace)


class PrivateConfigTest(unittest.TestCase):
    def test_atomic_write_replaces_a_symlink_without_touching_its_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / 'unrelated'
            target.write_text('keep this data')
            config = root / '.env'
            config.symlink_to(target)
            namespace['write_account_json'](config, {'token': 'test-only'})
            self.assertEqual(target.read_text(), 'keep this data')
            self.assertFalse(config.is_symlink())
            self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o600)

    def test_replacing_an_existing_file_restricts_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / 'account.json'
            config.write_text('{}')
            config.chmod(0o644)
            namespace['write_account_json'](config, {'token': 'test-only'})
            self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o600)
            self.assertEqual(json.loads(config.read_text()), {'token': 'test-only'})

    def test_writing_refuses_a_symlinked_configuration_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / 'target'
            target.mkdir()
            alias = root / 'alias'
            alias.symlink_to(target, target_is_directory=True)
            with self.assertRaises(OSError):
                namespace['write_account_json'](alias / '.env', {'token': 'test-only'})
            self.assertFalse((target / '.env').exists())


if __name__ == '__main__':
    unittest.main()
