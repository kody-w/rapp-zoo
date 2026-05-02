"""Flask test-client suite for rapp-zoo. Pure stdlib + flask, no real port."""

import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

try:
    import flask  # noqa
    HAVE_FLASK = True
except ImportError:
    HAVE_FLASK = False

_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))


class _Iso:
    """Isolate XDG_CONFIG_HOME / HOME / RAPP_HOME so tests never touch the user's config."""

    def __init__(self):
        self.tmp = tempfile.mkdtemp()

    def __enter__(self):
        self._prev = {}
        for k in ("XDG_CONFIG_HOME", "HOME", "RAPP_HOME"):
            self._prev[k] = os.environ.get(k)
        os.environ["XDG_CONFIG_HOME"] = self.tmp
        os.environ["HOME"] = self.tmp
        os.environ["RAPP_HOME"] = os.path.join(self.tmp, ".rapp")
        return self

    def __exit__(self, *exc):
        for k, v in self._prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)


def _make_repo(root: pathlib.Path) -> dict:
    rj = {
        "schema": "rapp-rappid/1.1",
        "rappid": "11111111-2222-3333-4444-555555555555",
        "parent_rappid": "37ad22f5-ed6d-48b1-b8b4-61019f58a42b",
        "parent_repo": "https://github.com/kody-w/wildhaven-ai-homes-twin.git",
        "parent_commit": "abc",
        "born_at": "2026-05-02T00:00:00Z",
        "name": "zoo-test-twin",
        "role": "variant",
        "kind": "test",
        "description": "for zoo tests",
        "attestation": None,
        "brainstem": {"version": "0.12.2"},
    }
    (root / "rappid.json").write_text(json.dumps(rj, indent=2))
    (root / "brainstem.py").write_text("# kernel\n")
    (root / "soul.md").write_text("# soul\n")
    (root / "agents").mkdir()
    (root / "agents" / "basic_agent.py").write_text("# a\n")
    (root / "utils").mkdir()
    (root / "utils" / "lineage_check.py").write_text("# stub\n")
    (root / "installer").mkdir()
    (root / "installer" / "VERSION").write_text("0.12.2\n")
    (root / "installer" / "start.sh").write_text("#!/bin/bash\necho ok\n")
    return rj


@unittest.skipUnless(HAVE_FLASK, "flask not installed")
class TestZooEndpoints(unittest.TestCase):
    def setUp(self):
        import zoo
        self.zoo = zoo
        self.app = zoo.create_app()
        self.client = self.app.test_client()

    def test_health_returns_ok(self):
        with _Iso():
            r = self.client.get("/api/health")
            self.assertEqual(r.status_code, 200)
            data = r.get_json()
            self.assertEqual(data["name"], "rapp-zoo")
            self.assertEqual(data["status"], "ok")

    def test_twins_empty(self):
        with _Iso():
            r = self.client.get("/api/twins")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.get_json()["twins"], [])

    def test_twins_after_upsert(self):
        with _Iso():
            sys.path.insert(0, str(_REPO_ROOT / "utils"))
            import peer_registry
            peer_registry.upsert("/tmp/host-a", 7071,
                                 rappid_uuid="aaa-1", twin_name="alice")
            peer_registry.upsert("/tmp/host-b", 7072,
                                 rappid_uuid="aaa-1", twin_name="alice")
            peer_registry.upsert("/tmp/host-c", 7073,
                                 rappid_uuid="bbb-2", twin_name="bob")
            r = self.client.get("/api/twins")
            data = r.get_json()
            self.assertEqual(len(data["twins"]), 2)
            twins_by_id = {t["rappid_uuid"]: t for t in data["twins"]}
            self.assertEqual(twins_by_id["aaa-1"]["incarnation_count"], 2)
            self.assertEqual(twins_by_id["bbb-2"]["name"], "bob")

    def test_eggs_empty(self):
        with _Iso():
            r = self.client.get("/api/eggs")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.get_json()["eggs"], [])

    def test_lay_egg_validation_400(self):
        with _Iso():
            r = self.client.post("/api/lay-egg", json={})
            self.assertEqual(r.status_code, 400)

    def test_lay_egg_then_summon_roundtrip(self):
        with _Iso():
            tmp = tempfile.mkdtemp()
            try:
                repo = pathlib.Path(tmp) / "repo"
                repo.mkdir()
                rj = _make_repo(repo)

                r1 = self.client.post("/api/lay-egg", json={"repo_path": str(repo)})
                self.assertEqual(r1.status_code, 200)
                ep = r1.get_json()["egg_path"]
                self.assertTrue(os.path.exists(ep))

                host = os.path.join(tmp, "host")
                os.makedirs(host, exist_ok=True)
                r2 = self.client.post("/api/summon",
                                      json={"egg_path": ep, "host_root": host})
                self.assertEqual(r2.status_code, 200)
                ws = r2.get_json()["workspace"]
                self.assertTrue(os.path.exists(ws))
                rj_after = json.loads((pathlib.Path(ws) / "rappid.json").read_text())
                self.assertEqual(rj_after["rappid"], rj["rappid"])
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

    def test_summon_validates_egg_path(self):
        with _Iso():
            r = self.client.post("/api/summon", json={"egg_path": "/no/such/file.egg"})
            self.assertEqual(r.status_code, 400)

    def test_hatch_requires_rappid_and_kernel(self):
        with _Iso():
            r = self.client.post("/api/hatch", json={})
            self.assertEqual(r.status_code, 400)

    def test_start_requires_rappid(self):
        with _Iso():
            r = self.client.post("/api/start", json={})
            self.assertEqual(r.status_code, 400)

    def test_start_returns_404_when_no_peer(self):
        with _Iso():
            r = self.client.post("/api/start",
                                 json={"rappid_uuid": "deadbeef-0000-1111-2222-333333333333"})
            self.assertEqual(r.status_code, 404)

    def test_stop_idempotent_when_not_running(self):
        with _Iso():
            r = self.client.post("/api/stop",
                                 json={"rappid_uuid": "no-such-rid"})
            self.assertEqual(r.status_code, 200)
            self.assertFalse(r.get_json()["was_running"])

    def test_serves_index_html_at_root(self):
        with _Iso():
            r = self.client.get("/")
            self.assertEqual(r.status_code, 200)
            # Must serve actual HTML or the JSON fallback
            ct = r.headers.get("Content-Type", "")
            self.assertTrue("html" in ct or "json" in ct)


if __name__ == "__main__":
    unittest.main()
