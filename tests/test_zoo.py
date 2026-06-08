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


def _make_brainstem_instance(root: pathlib.Path) -> dict:
    """Mimic a locally-hatched brainstem layout: rappid.json at the
    workspace root, kernel under src/rapp_brainstem/. This is what the
    install one-liner produces and what bond.pack_organism eggs.
    """
    rj = {
        "schema": "rapp-rappid/2.0",
        "rappid": "rappid:@local/zoo-test-organism:abcdef0123456789abcdef0123456789",
        "parent_rappid": "rappid:@rapp/origin:0b635450c04249fbb4b1bdb571044dec",
        "parent_repo": "github.com/kody-w/RAPP",
        "parent_commit": "deadbeef",
        "born_at": "2026-05-02T00:00:00Z",
        "kind": "brainstem-instance",
        "name": "zoo-test-organism",
        "incarnations": 1,
        "_migrated_from": "rappid:v2:hatched:@local/zoo-test-organism:abcdef0123456789abcdef0123456789",
    }
    (root / "rappid.json").write_text(json.dumps(rj, indent=2))
    src = root / "src" / "rapp_brainstem"
    src.mkdir(parents=True)
    (src / "VERSION").write_text("0.13.0\n")
    (src / "soul.md").write_text("## My customized soul\n")
    (src / ".env").write_text("PORT=7071\nGITHUB_TOKEN=\n")
    (src / "agents").mkdir()
    (src / "agents" / "basic_agent.py").write_text("# kernel infra\n")
    (src / "agents" / "weather_agent.py").write_text("class W: pass\n")
    (src / "utils").mkdir()
    (src / "utils" / "organs").mkdir()
    (src / "utils" / "organs" / "my_organ.py").write_text("# organ\n")
    (src / "utils" / "senses").mkdir()
    (src / "utils" / "senses" / "my_sense.py").write_text("# sense\n")
    (src / "utils" / "services").mkdir()
    (src / "utils" / "services" / "my_service.py").write_text("# svc\n")
    (src / ".brainstem_data").mkdir()
    (src / ".brainstem_data" / "memory").mkdir()
    (src / ".brainstem_data" / "memory" / "note.json").write_text('{"k":"v"}\n')
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

    def test_lay_egg_organism_then_summon_roundtrip(self):
        # 2.2-organism path: brainstem-instance layout (rappid.json above
        # src/rapp_brainstem/) → bond.pack_organism, summon into a
        # workspace whose layout mirrors a brainstem instance.
        with _Iso():
            tmp = tempfile.mkdtemp()
            try:
                inst = pathlib.Path(tmp) / "instance"
                inst.mkdir()
                rj = _make_brainstem_instance(inst)

                r1 = self.client.post("/api/lay-egg",
                                      json={"repo_path": str(inst)})
                self.assertEqual(r1.status_code, 200, r1.get_json())
                payload = r1.get_json()
                ep = payload["egg_path"]
                self.assertTrue(os.path.exists(ep))
                self.assertEqual(payload["rappid_uuid"], rj["rappid"])

                # /api/eggs should report the schema we just wrote
                r_list = self.client.get("/api/eggs")
                eggs = r_list.get_json()["eggs"]
                self.assertTrue(any(
                    e["schema"] == "brainstem-egg/2.2-organism"
                    and e["kernel_version"] == "0.13.0"
                    for e in eggs
                ), eggs)

                # Summon into a fresh host root → should land at
                # <host>/<rappid-hex-tail>/ with src/rapp_brainstem/...
                host = os.path.join(tmp, "host")
                r2 = self.client.post("/api/summon",
                                      json={"egg_path": ep, "host_root": host})
                self.assertEqual(r2.status_code, 200, r2.get_json())
                summoned = r2.get_json()
                self.assertEqual(summoned["schema"], "brainstem-egg/2.2-organism")
                ws = summoned["workspace"]
                self.assertTrue(os.path.isdir(ws))

                # Identity adopted
                rj_after = json.loads((pathlib.Path(ws) / "rappid.json").read_text())
                self.assertEqual(rj_after["rappid"], rj["rappid"])

                # Organism contents landed under the brainstem-instance layout
                ws_src = pathlib.Path(ws) / "src" / "rapp_brainstem"
                self.assertEqual((ws_src / "soul.md").read_text(),
                                 "## My customized soul\n")
                self.assertTrue((ws_src / "agents" / "weather_agent.py").exists())
                self.assertTrue((ws_src / "utils" / "organs" / "my_organ.py").exists())
                self.assertTrue((ws_src / "utils" / "senses" / "my_sense.py").exists())
                self.assertTrue((ws_src / "utils" / "services" / "my_service.py").exists())
                self.assertTrue((ws_src / ".brainstem_data" / "memory" / "note.json").exists())
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

    # ── Pokédex Tier 1+2 endpoints ──────────────────────────────────

    def test_starters_endpoint_lists_three(self):
        # The build_starters.py script pre-bakes 3 .egg files in
        # starters/dist/. The endpoint should pick them up and report
        # type / has_skin for each.
        with _Iso():
            r = self.client.get("/api/starters")
            self.assertEqual(r.status_code, 200)
            d = r.get_json()
            self.assertEqual(d["schema"], "rapp-zoo-starters/1.0")
            # Exactly three starters ship: workday, playtime, journal.
            ids = sorted(s["rapp_id"] for s in d["starters"])
            self.assertEqual(ids, ["journal", "playtime", "workday"])
            for s in d["starters"]:
                self.assertTrue(s["has_skin"], f"{s['rapp_id']} should have skin")
                self.assertTrue(s["egg_url"].startswith("/starters/dist/"))

    def test_starter_egg_downloadable(self):
        # The /starters/dist/<file>.egg route serves the pre-built eggs
        # so the UI can offer one-click download.
        with _Iso():
            r = self.client.get("/starters/dist/workday.egg")
            self.assertEqual(r.status_code, 200)
            # Should be a real zip blob (PK header)
            self.assertTrue(r.data.startswith(b"PK\x03\x04"))

    def test_discover_returns_upstream_url(self):
        with _Iso():
            r = self.client.get("/api/discover")
            self.assertEqual(r.status_code, 200)
            d = r.get_json()
            self.assertEqual(d["schema"], "rapp-zoo-discover/1.0")
            self.assertIn("upstream_url", d)
            self.assertIn("rapp_store", d["upstream_url"].lower())

    def test_import_egg_validates_upload(self):
        with _Iso():
            # No file → 400
            r = self.client.post("/api/import-egg")
            self.assertEqual(r.status_code, 400)

    def test_import_egg_round_trip(self):
        # Upload a real organism egg (built from a fake instance), then
        # confirm /api/eggs lists it under eggs/imported/.
        with _Iso():
            tmp = tempfile.mkdtemp()
            try:
                inst = pathlib.Path(tmp) / "instance"
                inst.mkdir()
                _make_brainstem_instance(inst)
                # Pack via bond directly to get a blob to upload
                sys.path.insert(0, str(_REPO_ROOT / "utils"))
                import bond as _bond
                blob = _bond.pack_organism(
                    str(inst),
                    str(inst / "src" / "rapp_brainstem"),
                    kernel_version="0.13.0"
                )
                # Upload as multipart
                r = self.client.post(
                    "/api/import-egg",
                    data={"egg": (__import__("io").BytesIO(blob), "uploaded.egg")},
                    content_type="multipart/form-data",
                )
                self.assertEqual(r.status_code, 200, r.get_json())
                d = r.get_json()
                self.assertTrue(d["ok"])
                self.assertIn("imported", d["egg_path"])
                self.assertTrue(os.path.exists(d["egg_path"]))
                # /api/eggs should now include the imported one
                eggs = self.client.get("/api/eggs").get_json()["eggs"]
                self.assertTrue(any("imported" in e["path"] for e in eggs))
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

    def test_export_egg_path_traversal_blocked(self):
        # ?path= must point inside ~/.rapp/eggs/. /etc/passwd type tries fail.
        with _Iso():
            r = self.client.get("/api/export-egg?path=/etc/passwd")
            self.assertEqual(r.status_code, 403)

    def test_export_egg_streams_bytes(self):
        with _Iso():
            tmp = tempfile.mkdtemp()
            try:
                # Drop a fake egg into the eggs dir
                eggs_dir = os.path.join(os.environ["RAPP_HOME"], "eggs", "test")
                os.makedirs(eggs_dir, exist_ok=True)
                fake = os.path.join(eggs_dir, "marker.egg")
                with open(fake, "wb") as f:
                    f.write(b"PK\x03\x04fake-egg-bytes-for-test")
                r = self.client.get("/api/export-egg?path=" + fake)
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.data, b"PK\x03\x04fake-egg-bytes-for-test")
                # Content-Disposition should be set so browser downloads it
                cd = r.headers.get("Content-Disposition", "")
                self.assertIn("attachment", cd)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

    def test_egg_manifest_peek(self):
        with _Iso():
            tmp = tempfile.mkdtemp()
            try:
                inst = pathlib.Path(tmp) / "instance"
                inst.mkdir()
                _make_brainstem_instance(inst)
                # Lay an egg through the API → peek its manifest
                r1 = self.client.post("/api/lay-egg", json={"repo_path": str(inst)})
                ep = r1.get_json()["egg_path"]
                r2 = self.client.get("/api/eggs/manifest?path=" + ep)
                self.assertEqual(r2.status_code, 200)
                d = r2.get_json()
                self.assertTrue(d["ok"])
                self.assertEqual(d["manifest"]["schema"], "brainstem-egg/2.2-organism")
                self.assertIsInstance(d["file_tree"], list)
                self.assertIn("manifest.json", d["file_tree"])
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

    def test_reveal_path_safety(self):
        # Reveal must refuse paths outside ~/.rapp/
        with _Iso():
            r = self.client.post("/api/reveal", json={"path": "/etc"})
            self.assertEqual(r.status_code, 403)
            r2 = self.client.post("/api/reveal", json={})
            self.assertEqual(r2.status_code, 400)


if __name__ == "__main__":
    unittest.main()
