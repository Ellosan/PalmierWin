import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  UpdateManager,
  RELEASES_PAGE,
  RELEASES_URL,
  selectRelease,
} from "../src/desktop/updates.mjs";

function release(version, prerelease = false, extras = {}) {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    prerelease,
    draft: false,
    assets: [
      "latest.yml",
      `PalmierWin-${version}-x64-Setup.exe`,
      `PalmierWin-${version}-x64-Portable.exe`,
    ].map((name) => ({
      name,
      browser_download_url: `${RELEASES_PAGE}/download/${tag}/${name}`,
    })),
    ...extras,
  };
}
class FakeUpdater extends EventEmitter {
  constructor(version = "0.2.0") {
    super();
    this.version = version;
    this.downloads = 0;
    this.installs = 0;
  }
  setFeedURL(value) {
    this.feed = value;
  }
  async checkForUpdates() {
    return { updateInfo: { version: this.version } };
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", { percent: 53.2 });
  }
  quitAndInstall(silent, restart) {
    this.installs++;
    this.installArgs = [silent, restart];
  }
}
function manager(options = {}) {
  return new UpdateManager({
    version: "0.1.2",
    supported: true,
    updater: new FakeUpdater(),
    config: { automatic: false },
    fetchImpl: async () => Response.json([release("0.2.0")]),
    ...options,
  });
}

test("Stable filters GitHub prerelease flags and prerelease semvers, including older plain-version betas", () => {
  const releases = [
    release("0.9.0", true),
    release("0.8.0-beta.1"),
    release("0.2.0"),
  ];
  assert.equal(selectRelease(releases, "0.1.2", "stable").tag_name, "v0.2.0");
  assert.equal(selectRelease(releases, "0.1.2", "beta").tag_name, "v0.9.0");
});
test("Beta chooses the highest semantic version regardless of publication order, and can graduate to Stable", () => {
  assert.equal(
    selectRelease(
      [release("0.2.0-beta.1", true), release("0.2.0"), release("0.1.3")],
      "0.1.2",
      "beta",
    ).tag_name,
    "v0.2.0",
  );
});
test("drafts, malformed tags, missing manifests and off-repository download URLs are ignored", () => {
  const bad = release("0.9.0");
  bad.assets[0].browser_download_url = "https://evil.example/latest.yml";
  assert.equal(
    selectRelease(
      [
        bad,
        release("0.8.0", false, { draft: true }),
        release("0.7.0", false, { assets: [] }),
        release("0.6.0", false, { tag_name: "not-a-version" }),
      ],
      "0.1.2",
      "beta",
    ),
    null,
  );
});
test("switching to Stable never downgrades an installed Beta or reinstalls the current version", () => {
  assert.equal(
    selectRelease(
      [release("0.1.1"), release("0.1.2-beta.1", true)],
      "0.1.2-beta.1",
      "stable",
    ),
    null,
  );
  assert.equal(selectRelease([release("0.1.2")], "0.1.2", "stable"), null);
});
test("unknown channels and invalid API responses are rejected", () => {
  assert.throws(() => selectRelease([], "0.1.2", "nightly"), /Stable or Beta/);
  assert.throws(
    () => selectRelease({}, "0.1.2", "stable"),
    /invalid release list/,
  );
});
test("a fresh Beta defaults to Beta while an explicit stored channel wins", () => {
  assert.equal(manager({ version: "0.1.2-beta.1" }).state.channel, "beta");
  assert.equal(
    manager({ version: "0.1.2-beta.1", config: { channel: "stable" } }).state
      .channel,
    "stable",
  );
});
test("checking pins a verified GitHub tag without sending provider credentials", async () => {
  const m = manager({
    fetchImpl: async (url, options) => {
      assert.equal(url, RELEASES_URL);
      assert.equal(options.headers.Authorization, undefined);
      return Response.json([release("0.2.0")]);
    },
  });
  await m.check();
  assert.equal(m.state.phase, "available");
  assert.equal(m.updater.feed.url, `${RELEASES_PAGE}/download/v0.2.0/`);
  assert.equal(m.updater.allowDowngrade, false);
  assert.equal(m.updater.autoInstallOnAppQuit, false);
  assert.equal(m.updater.downloads, 0);
});
test("automatic mode downloads, reports progress, and waits for an explicit restart", async () => {
  const states = [];
  const m = manager({
    config: { automatic: true },
    onChange: (value) => states.push(value),
  });
  await m.check();
  assert.equal(m.state.phase, "ready");
  assert.equal(m.updater.downloads, 1);
  assert.equal(m.updater.installs, 0);
  assert.ok(states.some((state) => state.progress === 53.2));
});
test("installation saves recovery first and refuses to run during an export", async () => {
  const m = manager({
    beforeInstall: async () => {
      throw new Error("Finish the export first.");
    },
  });
  await m.check();
  await m.download();
  await assert.rejects(m.install(), /export/);
  assert.equal(m.state.phase, "ready");
  assert.equal(m.updater.installs, 0);
  let saved = false;
  m.beforeInstall = async () => {
    saved = true;
  };
  m.updater.quitAndInstall = () => {
    assert.equal(saved, true);
    m.updater.installs++;
  };
  await m.install();
  assert.equal(m.updater.installs, 1);
});
test("a hash verification or download failure cannot become installable", async () => {
  const m = manager();
  m.updater.downloadUpdate = async () => {
    throw new Error("SHA512 mismatch");
  };
  await m.check();
  await m.download();
  assert.equal(m.state.phase, "error");
  await assert.rejects(m.install(), /verify/);
  assert.equal(m.updater.installs, 0);
});
test("release version mismatches are blocked before downloading", async () => {
  const m = manager({
    updater: new FakeUpdater("9.9.9"),
    config: { automatic: true },
  });
  await m.check();
  assert.equal(m.state.phase, "error");
  assert.match(m.state.message, /does not match/);
  assert.equal(m.updater.downloads, 0);
});
test("changing channels invalidates a downloaded update and persists the preference", async () => {
  let persisted;
  const m = manager({
    persist: async (value) => {
      persisted = value;
    },
  });
  await m.check();
  await m.download();
  await m.configure({ channel: "beta", automatic: false });
  assert.deepEqual(persisted, { channel: "beta", automatic: false });
  assert.equal(m.state.phase, "idle");
  await assert.rejects(m.install(), /Download and verify/);
});
test("preferences cannot race a download and failed persistence leaves the selection intact", async () => {
  const m = manager({
    persist: async () => {
      throw new Error("disk full");
    },
  });
  await assert.rejects(
    m.configure({ channel: "beta", automatic: false }),
    /disk full/,
  );
  assert.equal(m.state.channel, "stable");
  m.patch({ phase: "downloading" });
  await assert.rejects(
    m.configure({ channel: "beta", automatic: false }),
    /Wait/,
  );
});
test("Portable checks offer a verified portable file without running an installer", async () => {
  const m = manager({
    portable: true,
    updater: null,
    config: { automatic: true },
  });
  await m.check();
  assert.equal(m.state.phase, "available");
  assert.equal(
    m.portableDownload(),
    `${RELEASES_PAGE}/download/v0.2.0/PalmierWin-0.2.0-x64-Portable.exe`,
  );
  await assert.rejects(m.install(), /Download and verify/);
});
test("no Stable release and GitHub rate limits have explicit recoverable states", async () => {
  const m = manager({
    fetchImpl: async () => Response.json([release("0.2.0", true)]),
  });
  await m.check();
  assert.equal(m.state.phase, "current");
  assert.match(m.state.message, /No stable release/);
  m.fetchImpl = async () => new Response(null, { status: 403 });
  await m.check();
  assert.equal(m.state.phase, "error");
  assert.match(m.state.message, /limiting update checks/);
});
test("development mode never checks GitHub or starts an installer", async () => {
  const m = manager({
    supported: false,
    fetchImpl: () => {
      throw new Error("must not fetch");
    },
  });
  await m.check();
  assert.equal(m.state.phase, "unsupported");
  await assert.rejects(m.install(), /Download and verify/);
  m.start();
  assert.equal(m.interval, undefined);
});
