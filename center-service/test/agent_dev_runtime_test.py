import os
import sys
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from center_agent_dev import dev_connect, dev_handler, dev_sql_connect, dev_post


class AgentDevRuntimeTests(unittest.TestCase):
    def test_http_rejects_email_and_non_center_destinations(self):
        with patch.dict(os.environ, {'CENTER_API_ORIGIN': 'https://dev.metasperu.net.pe'}), patch('center_agent_dev.agent_post') as send:
            for url in ('https://external.invalid/callback', 'https://api.metasperu.net.pe/s3/inventory/response/store',
                        'https://api.metasperu.net.pe/s4/center/inventory/api/inventory/send/email'):
                with self.assertRaises(RuntimeError):
                    dev_post(url, json={})
            send.assert_not_called()
            dev_post('https://api.metasperu.net.pe/s1/center/api/parameters/store', json={})
            send.assert_called_once()

    def test_production_is_never_a_fallback(self):
        client = Mock()
        with patch.dict(os.environ, {'CENTER_API_ORIGIN': 'https://api.metasperu.net.pe'}):
            with self.assertRaises(RuntimeError):
                dev_connect(client, 'https://api.metasperu.net.pe')
        client.connect.assert_not_called()

    def test_socket_authentication_uses_dev_and_private_token(self):
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / 'agent.token'
            token.write_text('fixture-only-' * 4, encoding='utf-8')
            with patch.dict(os.environ, {'CENTER_API_ORIGIN': 'https://dev.metasperu.net.pe', 'CENTER_AGENT_TOKEN_FILE': str(token)}):
                client = Mock()
                dev_connect(client, 'https://api.metasperu.net.pe', socketio_path='s5/socket')
                self.assertEqual(client.connect.call_args.args, ('https://dev.metasperu.net.pe',))
                self.assertEqual(client.connect.call_args.kwargs['auth']['agentToken'], 'fixture-only-' * 4)

    def test_write_and_unknown_events_are_blocked_before_callback(self):
        with patch.dict(os.environ, {'CENTER_API_ORIGIN': 'https://dev.metasperu.net.pe'}):
            for event in ('py_delete_client', 'py_request_insert_cuo', 'py_request_kardex_campos_libres', 'unknown'):
                callback = Mock()
                with self.assertRaises(RuntimeError):
                    dev_handler(event)(callback)({})
                callback.assert_not_called()
            callback = Mock(return_value='ok')
            self.assertEqual(dev_handler('py_request_inventory')(callback)({}), 'ok')

    def test_multiple_source_databases_use_distinct_explicit_sandbox_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'sql.json'
            filename.write_text(json.dumps({'agent:1': {'A': 'DATABASE=QA_A;', 'B': 'DATABASE=QA_B;'}}), encoding='utf-8')
            driver = Mock()
            with patch.dict(os.environ, {'CENTER_API_ORIGIN': 'https://dev.metasperu.net.pe',
                    'CENTER_AGENT_SQL_FILE': str(filename), 'CENTER_AGENT_SQL_SANDBOX': '1'}), patch.dict(sys.modules, {'pyodbc': driver}):
                dev_sql_connect('agent:1', 'DATABASE=A;PWD=[CONFIGURACION_EXTERNA];')
                dev_sql_connect('agent:1', 'DATABASE=B;PWD=[CONFIGURACION_EXTERNA];')
                self.assertEqual([call.args[0] for call in driver.connect.call_args_list], ['DATABASE=QA_A;', 'DATABASE=QA_B;'])
                with self.assertRaises(RuntimeError):
                    dev_sql_connect('agent:1', 'DATABASE=NOT_CONFIGURED;')


if __name__ == '__main__':
    unittest.main()
