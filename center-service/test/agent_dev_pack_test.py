import ast
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'prepare_agent_dev.py'


class AgentDevPackTests(unittest.TestCase):
    def load_builder(self):
        spec = importlib.util.spec_from_file_location('prepare_agent_dev', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_preparation_never_executes_source_and_removes_embedded_credentials(self):
        builder = self.load_builder()
        source = '''import pyodbc, requests
raise RuntimeError("SOURCE MUST NOT RUN")
connection = f"DRIVER={{SQL Server}};SERVER={host};UID=fixture-secret;PWD=fixture-secret;"
conn = pyodbc.connect(connection)
requests.post("https://api.metasperu.net.pe/s1/center/api/result", json={})
sio.connect("https://api.metasperu.net.pe", socketio_path="s1/socket")
'''
        result, slots = builder.adapt_source(source, 'centerService.py')
        self.assertNotIn('fixture-secret', result)
        self.assertIn('dev_sql_connect', result)
        self.assertIn('dev_connect', result)
        self.assertIn('agent_post', result)
        self.assertEqual(len(slots), 1)
        compile(result, 'prepared.py', 'exec')

    def test_unknown_and_non_center_agents_are_never_prepared(self):
        builder = self.load_builder()
        with self.assertRaises(ValueError):
            builder.adapt_source('pass', 'inventarioService.py')
        with self.assertRaises(ValueError):
            builder.adapt_source('pass', 'agenteServer_RRHH.py')

    def test_originals_remain_unchanged_and_existing_output_is_not_overwritten(self):
        builder = self.load_builder()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.mkdir()
            for filename in builder.CENTER_AGENTS:
                (source / filename).write_text('raise RuntimeError("DO NOT RUN")\n', encoding='utf-8')
            before = {p.name: p.read_bytes() for p in source.iterdir()}
            output = root / 'dev'
            builder.prepare(source, output)
            self.assertEqual(before, {p.name: p.read_bytes() for p in source.iterdir()})
            self.assertTrue((output / 'manifest.json').exists())
            with self.assertRaises(FileExistsError):
                builder.prepare(source, output)


if __name__ == '__main__':
    unittest.main()
