"""Flask integration tests for the RAPP/1 rapp-zoo control plane."""

import io
import importlib.util
import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "utils"))

import bond
import peer_registry
import rapp_protocol as R
import zoo


SPECIES_ROOT = (
    "rappid:@kody-w/rapp:"
    "9a8f0a4b5a710e20f4d819a0f37d2a4c9f113b5e78fb3c29e70b54fff48a38f9"
)


class IsolatedHome:
    def __enter__(self):
        self.tmp = tempfile.mkdtemp()
        self.previous = {
            key: os.environ.get(key)
            for key in (
                "XDG_CONFIG_HOME",
                "HOME",
                "RAPP_HOME",
                "RAPP_OWNER",
                "RAPP_REGISTRY_PATH",
                "RAPP_ESTATE_OWNER_RAPPID",
                "RAPP_ESTATE_OWNER_SPKI_PATH",
            )
        }
        os.environ["XDG_CONFIG_HOME"] = self.tmp
        os.environ["HOME"] = self.tmp
        os.environ["RAPP_HOME"] = os.path.join(self.tmp, ".rapp")
        os.environ["RAPP_OWNER"] = "kody-w"
        for key in (
            "RAPP_REGISTRY_PATH",
            "RAPP_ESTATE_OWNER_RAPPID",
            "RAPP_ESTATE_OWNER_SPKI_PATH",
        ):
            os.environ.pop(key, None)
        return self

    def __exit__(self, *_):
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmp, ignore_errors=True)


def write_identity(path: pathlib.Path, rid: str, name: str, **extra) -> dict:
    identity = {
        "schema": "rapp/1",
        "rappid": rid,
        "parent_rappid": SPECIES_ROOT,
        "name": name,
        **extra,
    }
    path.write_text(json.dumps(identity, indent=2) + "\n")
    return identity


def make_variant_repo(root: pathlib.Path, suffix: str = "1") -> dict:
    rid = f"rappid:@kody-w/zoo-test-twin:{suffix * 64}"
    identity = write_identity(
        root / "rappid.json",
        rid,
        "zoo-test-twin",
        kind="test",
        parent_repo="https://github.com/kody-w/wildhaven-ai-homes-twin.git",
    )
    (root / "brainstem.py").write_text("# old kernel\n")
    (root / "soul.md").write_text("# soul\n")
    (root / "agents").mkdir()
    (root / "agents" / "demo_agent.py").write_text("class Demo: pass\n")
    (root / ".brainstem_data").mkdir()
    (root / ".brainstem_data" / "memory.json").write_text('{"memory":"kept"}\n')
    (root / "installer").mkdir()
    (root / "installer" / "start.sh").write_text("#!/bin/bash\nexit 0\n")
    return identity


def make_brainstem_instance(root: pathlib.Path) -> dict:
    rid = "rappid:@kody-w/zoo-test-organism:" + "a" * 64
    identity = write_identity(
        root / "rappid.json",
        rid,
        "zoo-test-organism",
        kind="brainstem-instance",
        incarnations=1,
    )
    src = root / "src" / "rapp_brainstem"
    src.mkdir(parents=True)
    (src / "VERSION").write_text("0.13.0\n")
    (src / "brainstem.py").write_text("# kernel\n")
    (src / "soul.md").write_text("## Customized soul\n")
    (src / ".env").write_text("PORT=7071\nGITHUB_TOKEN=secret\n")
    (src / "agents").mkdir()
    (src / "agents" / "basic_agent.py").write_text("# infrastructure\n")
    (src / "agents" / "weather_agent.py").write_text("class Weather: pass\n")
    for subtree, filename in (
        ("organs", "my_organ.py"),
        ("senses", "my_sense.py"),
        ("services", "my_service.py"),
    ):
        directory = src / "utils" / subtree
        directory.mkdir(parents=True)
        (directory / filename).write_text(f"# {subtree}\n")
    memory = src / ".brainstem_data" / "memory"
    memory.mkdir(parents=True)
    (memory / "note.json").write_text('{"k":"v"}\n')
    return identity


class TestZooEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = zoo.create_app().test_client()

    def test_health_and_empty_collection(self):
        with IsolatedHome():
            health = self.client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.get_json()["status"], "ok")
            self.assertEqual(self.client.get("/api/twins").get_json()["twins"], [])
            self.assertEqual(self.client.get("/api/eggs").get_json()["eggs"], [])

    def test_desktop_health_capability_header_is_process_bound(self):
        with IsolatedHome():
            os.environ["RAPP_ZOO_DESKTOP_TOKEN"] = "a" * 64
            try:
                response = self.client.get("/api/health")
                self.assertEqual(
                    response.headers["X-RAPP-Zoo-Desktop"],
                    "a" * 64,
                )
            finally:
                os.environ.pop("RAPP_ZOO_DESKTOP_TOKEN", None)

    def test_collection_groups_lineage_but_keeps_instance_ids(self):
        with IsolatedHome():
            artifact = "rappid:@kody-w/artifact:" + "a" * 64
            one = "rappid:@kody-w/artifact-instance:" + "1" * 64
            two = "rappid:@kody-w/artifact-instance:" + "2" * 64
            peer_registry.upsert(
                "/tmp/one",
                7081,
                instance_rappid=one,
                artifact_rappid=artifact,
                grown_from="3" * 64,
                twin_name="artifact",
            )
            peer_registry.upsert(
                "/tmp/two",
                7082,
                instance_rappid=two,
                artifact_rappid=artifact,
                grown_from="3" * 64,
                twin_name="artifact",
            )
            twins = self.client.get("/api/twins").get_json()["twins"]
            self.assertEqual(len(twins), 1)
            self.assertEqual(twins[0]["artifact_rappid"], artifact)
            self.assertEqual(
                {item["instance_rappid"] for item in twins[0]["instances"]},
                {one, two},
            )

    def test_variant_repo_lay_and_hatch_mints_fresh_instance(self):
        with IsolatedHome(), tempfile.TemporaryDirectory() as tmp:
            repo = pathlib.Path(tmp) / "repo"
            repo.mkdir()
            artifact = make_variant_repo(repo)
            laid = self.client.post("/api/lay-egg", json={"repo_path": str(repo)})
            self.assertEqual(laid.status_code, 200, laid.get_json())
            laid_json = laid.get_json()
            self.assertEqual(laid_json["schema"], "rapp/1-egg")
            self.assertEqual(laid_json["variant"], "organism")

            host = pathlib.Path(tmp) / "host"
            hatched = self.client.post(
                "/api/summon",
                json={
                    "egg_path": laid_json["egg_path"],
                    "host_root": str(host),
                    "owner": "kody-w",
                },
            )
            self.assertEqual(hatched.status_code, 200, hatched.get_json())
            result = hatched.get_json()
            workspace = pathlib.Path(result["workspace"])
            live = json.loads((workspace / "rappid.json").read_text())
            packed = json.loads((workspace / "artifact-rappid.json").read_text())
            self.assertEqual(packed["rappid"], artifact["rappid"])
            self.assertNotEqual(live["rappid"], artifact["rappid"])
            self.assertEqual(live["artifact_rappid"], artifact["rappid"])
            self.assertEqual(live["grown_from"], laid_json["egg_hash"])
            self.assertEqual((workspace / "soul.md").read_text(), "# soul\n")
            self.assertTrue((workspace / "agents" / "demo_agent.py").is_file())

    def test_two_hatches_share_artifact_not_instance_identity(self):
        with IsolatedHome(), tempfile.TemporaryDirectory() as tmp:
            repo = pathlib.Path(tmp) / "repo"
            repo.mkdir()
            artifact = make_variant_repo(repo)
            laid = self.client.post(
                "/api/lay-egg", json={"repo_path": str(repo)}
            ).get_json()
            instances = []
            for _ in range(2):
                response = self.client.post(
                    "/api/summon",
                    json={
                        "egg_path": laid["egg_path"],
                        "host_root": str(pathlib.Path(tmp) / "host"),
                        "owner": "kody-w",
                    },
                )
                self.assertEqual(response.status_code, 200, response.get_json())
                instances.append(response.get_json())
            self.assertEqual(
                {item["artifact_rappid"] for item in instances},
                {artifact["rappid"]},
            )
            self.assertEqual({item["grown_from"] for item in instances}, {laid["egg_hash"]})
            self.assertEqual(len({item["instance_rappid"] for item in instances}), 2)

    def test_brainstem_instance_lay_and_hatch(self):
        with IsolatedHome(), tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "instance"
            source.mkdir()
            artifact = make_brainstem_instance(source)
            laid = self.client.post(
                "/api/lay-egg", json={"repo_path": str(source)}
            )
            self.assertEqual(laid.status_code, 200, laid.get_json())
            egg_path = pathlib.Path(laid.get_json()["egg_path"])
            ok, _, why = R.verify_egg(egg_path.read_bytes())
            self.assertTrue(ok, why)

            hatched = self.client.post(
                "/api/summon",
                json={
                    "egg_path": str(egg_path),
                    "host_root": str(pathlib.Path(tmp) / "host"),
                    "owner": "kody-w",
                },
            )
            self.assertEqual(hatched.status_code, 200, hatched.get_json())
            workspace = pathlib.Path(hatched.get_json()["workspace"])
            src = workspace / "src" / "rapp_brainstem"
            live = json.loads((workspace / "rappid.json").read_text())
            self.assertNotEqual(live["rappid"], artifact["rappid"])
            self.assertEqual(live["artifact_rappid"], artifact["rappid"])
            self.assertEqual((src / "soul.md").read_text(), "## Customized soul\n")
            self.assertTrue((src / "agents" / "weather_agent.py").is_file())
            self.assertEqual(
                (src / ".env").read_text(),
                "PORT=7071\nGITHUB_TOKEN=\n",
            )

    def test_in_place_bond_preserves_instance_identity(self):
        with IsolatedHome(), tempfile.TemporaryDirectory() as tmp:
            workspace = pathlib.Path(tmp) / "workspace"
            workspace.mkdir()
            identity = make_variant_repo(workspace)
            peer_registry.upsert(
                str(workspace),
                7081,
                instance_rappid=identity["rappid"],
                twin_name=identity["name"],
            )
            new_kernel = pathlib.Path(tmp) / "brainstem.py"
            new_kernel.write_text("# new kernel\n")
            response = self.client.post(
                "/api/bond",
                json={
                    "instance_rappid": identity["rappid"],
                    "new_kernel": str(new_kernel),
                },
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            after = json.loads((workspace / "rappid.json").read_text())
            self.assertEqual(after["rappid"], identity["rappid"])
            self.assertEqual((workspace / "brainstem.py").read_text(), "# new kernel\n")

    def test_tampered_egg_is_refused_before_persistence(self):
        with IsolatedHome():
            rid = R.mint_rappid("kody-w", "tampered", uuid_bytes=b"t" * 16)
            valid = R.pack_egg(
                "organism",
                rid,
                "2026-08-28T20:00:00.000Z",
                files={
                    "rappid.json": (
                        json.dumps({"schema": "rapp/1", "rappid": rid}) + "\n"
                    ).encode(),
                    "soul.md": b"# soul\n",
                },
            )
            manifest, files = R.read_egg(valid)
            files["soul.md"] = b"# altered\n"
            tampered = R.serialize_egg(manifest, files)
            response = self.client.post(
                "/api/import-egg",
                data={"egg": (io.BytesIO(tampered), "tampered.egg")},
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 422)
            imported = pathlib.Path(os.environ["RAPP_HOME"]) / "eggs" / "imported"
            self.assertFalse(imported.exists())

    def test_import_accepts_zip_and_json_variants(self):
        with IsolatedHome(), tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "instance"
            source.mkdir()
            make_brainstem_instance(source)
            organism = bond.pack_organism(
                str(source), str(source / "src" / "rapp_brainstem"), "0.13.0"
            )
            response = self.client.post(
                "/api/import-egg",
                data={"egg": (io.BytesIO(organism), "organism.egg")},
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 200, response.get_json())

            session_rid = R.mint_rappid(
                "kody-w", "session", uuid_bytes=b"s" * 16
            )
            session = R.pack_egg(
                "session",
                session_rid,
                "2026-08-28T20:00:00.000Z",
                payload={"runtime": "brainstem", "transcript": []},
            )
            json_response = self.client.post(
                "/api/import-egg",
                data={"egg": (io.BytesIO(session), "session.egg")},
                content_type="multipart/form-data",
            )
            self.assertEqual(json_response.status_code, 200, json_response.get_json())
            self.assertEqual(
                json_response.get_json()["manifest"]["variant"], "session"
            )

    def test_verified_non_organism_is_not_summoned_as_standalone(self):
        with IsolatedHome(), tempfile.TemporaryDirectory() as tmp:
            rid = R.mint_rappid("kody-w", "session", uuid_bytes=b"s" * 16)
            session = R.pack_egg(
                "session",
                rid,
                "2026-08-28T20:00:00.000Z",
                payload={"runtime": "brainstem", "transcript": []},
            )
            egg_path = pathlib.Path(tmp) / "session.egg"
            egg_path.write_bytes(session)
            response = self.client.post(
                "/api/summon", json={"egg_path": str(egg_path)}
            )
            self.assertEqual(response.status_code, 422)

    def test_manifest_inspection_requires_managed_verified_egg(self):
        with IsolatedHome(), tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "instance"
            source.mkdir()
            make_brainstem_instance(source)
            laid = self.client.post(
                "/api/lay-egg", json={"repo_path": str(source)}
            ).get_json()
            response = self.client.get(
                "/api/eggs/manifest?path=" + laid["egg_path"]
            )
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()["manifest"]["schema"], "rapp/1-egg")
            self.assertIn("manifest.json", response.get_json()["file_tree"])

            outside = pathlib.Path(tmp) / "outside.egg"
            outside.write_bytes(pathlib.Path(laid["egg_path"]).read_bytes())
            blocked = self.client.get(
                "/api/eggs/manifest?path=" + str(outside)
            )
            self.assertEqual(blocked.status_code, 403)

    def test_starters_are_committed_conformant_eggs(self):
        with IsolatedHome():
            response = self.client.get("/api/starters")
            self.assertEqual(response.status_code, 200)
            starters = response.get_json()["starters"]
            self.assertEqual(
                sorted(item["rapp_id"] for item in starters),
                ["journal", "playtime", "workday"],
            )
            for item in starters:
                self.assertTrue(item["has_skin"])
                blob = (ROOT / "starters" / "dist" / f"{item['rapp_id']}.egg").read_bytes()
                self.assertEqual(R.verify_egg(blob), (True, None, "ok"))

    def test_starter_build_is_byte_reproducible(self):
        spec = importlib.util.spec_from_file_location(
            "starter_builder",
            ROOT / "starters" / "build_starters.py",
        )
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        with tempfile.TemporaryDirectory() as tmp:
            for starter in builder.STARTERS:
                first = pathlib.Path(tmp) / f"{starter['rapp_id']}-1.egg"
                second = pathlib.Path(tmp) / f"{starter['rapp_id']}-2.egg"
                builder.build_one(starter, first)
                builder.build_one(starter, second)
                self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_export_and_reveal_path_guards(self):
        with IsolatedHome():
            self.assertEqual(
                self.client.get("/api/export-egg?path=/etc/passwd").status_code,
                403,
            )
            self.assertEqual(
                self.client.post("/api/reveal", json={"path": "/etc"}).status_code,
                403,
            )

    def test_process_and_bond_validation(self):
        with IsolatedHome():
            self.assertEqual(self.client.post("/api/start", json={}).status_code, 400)
            self.assertEqual(self.client.post("/api/stop", json={}).status_code, 400)
            self.assertEqual(self.client.post("/api/bond", json={}).status_code, 400)
            missing = "rappid:@kody-w/missing:" + "f" * 64
            self.assertEqual(
                self.client.post(
                    "/api/start", json={"instance_rappid": missing}
                ).status_code,
                404,
            )
            stopped = self.client.post(
                "/api/stop", json={"instance_rappid": missing}
            )
            self.assertEqual(stopped.status_code, 200)
            self.assertFalse(stopped.get_json()["was_running"])

    def test_static_ui_and_discover(self):
        with IsolatedHome():
            root = self.client.get("/")
            self.assertEqual(root.status_code, 200)
            self.assertIn("Content-Security-Policy", root.headers)
            root.close()
            manifest = self.client.get("/manifest.webmanifest")
            self.assertEqual(manifest.status_code, 200)
            manifest.close()
            worker = self.client.get("/sw.js")
            self.assertEqual(worker.status_code, 200)
            worker.close()
            discover = self.client.get("/api/discover")
            self.assertEqual(discover.status_code, 200)
            self.assertIn("upstream_url", discover.get_json())

    def test_intelligence_context_is_semantic_and_path_free(self):
        with IsolatedHome():
            artifact = "rappid:@kody-w/context:" + "a" * 64
            instance = "rappid:@kody-w/context-instance:" + "b" * 64
            private_path = os.path.join(os.environ["HOME"], "private-workspace")
            peer_registry.upsert(
                private_path,
                0,
                instance_rappid=instance,
                artifact_rappid=artifact,
                grown_from="c" * 64,
                twin_name="context",
            )
            response = self.client.get("/api/intelligence-context")
            self.assertEqual(response.status_code, 200)
            encoded = json.dumps(response.get_json())
            self.assertNotIn(private_path, encoded)
            self.assertEqual(response.get_json()["health"]["instance_count"], 1)
            self.assertIn("copilot.open", response.get_json()["visible_controls"])


if __name__ == "__main__":
    unittest.main()
