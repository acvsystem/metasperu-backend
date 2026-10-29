import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from center_agent_auth import agent_post, agent_token, agent_api_origin


class AgentAuthenticationTests(unittest.TestCase):
    def test_token_is_sent_only_to_center_and_never_follows_redirects(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "test.token"
            filename.write_text("qa-only-" * 8, encoding="utf-8")
            with patch.dict(os.environ, {"CENTER_AGENT_TOKEN_FILE": str(filename)}):
                with patch("center_agent_auth.requests.post") as send:
                    agent_post("https://api.metasperu.net.pe/s1/center/api/parameters/store", json={})
                    self.assertEqual(send.call_args.kwargs["headers"]["x-center-agent"], "qa-only-" * 8)
                    self.assertFalse(send.call_args.kwargs["allow_redirects"])
                    agent_post("https://external.example.invalid/callback", json={})
                    self.assertNotIn("headers", send.call_args.kwargs)

    def test_missing_or_relative_credentials_fail_closed(self):
        with patch.dict(os.environ, {"CENTER_AGENT_TOKEN_FILE": "relative.token"}):
            with self.assertRaises(RuntimeError):
                agent_token()

    def test_development_destination_is_explicit_and_never_leaks_tokens_to_other_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'test.token'
            filename.write_text('qa-only-' * 8, encoding='utf-8')
            with patch.dict(os.environ, {'CENTER_API_ORIGIN': 'https://dev.metasperu.net.pe', 'CENTER_AGENT_TOKEN_FILE': str(filename)}):
                self.assertEqual(agent_api_origin(), 'https://dev.metasperu.net.pe')
                with patch('center_agent_auth.requests.post') as send:
                    agent_post('https://api.metasperu.net.pe/s5/center/resources/human/api/hours/works/employes/response', json={})
                    self.assertTrue(send.call_args.args[0].startswith('https://dev.metasperu.net.pe/'))
                    agent_post('https://api.metasperu.net.pe/s3/inventory/response/store', json={})
                    self.assertNotIn('headers', send.call_args.kwargs)
            with patch.dict(os.environ, {'CENTER_API_ORIGIN': 'https://external.invalid'}):
                with self.assertRaises(RuntimeError):
                    agent_api_origin()


if __name__ == "__main__":
    unittest.main()
