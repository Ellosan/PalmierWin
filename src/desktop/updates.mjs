import semver from "semver";

export const RELEASES_URL =
  "https://api.github.com/repos/Ellosan/PalmierWin/releases?per_page=100";
export const RELEASES_PAGE = "https://github.com/Ellosan/PalmierWin/releases";
const channels = new Set(["stable", "beta"]);

export function releaseAsset(release, name) {
  const asset = release.assets?.find((asset) => asset.name === name);
  if (!asset) return null;
  const expected = `${RELEASES_PAGE}/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(name)}`;
  return asset.browser_download_url === expected ? expected : null;
}

export function selectRelease(releases, currentVersion, channel) {
  if (!channels.has(channel)) throw new Error("Choose Stable or Beta updates.");
  if (!Array.isArray(releases))
    throw new Error("GitHub returned an invalid release list.");
  return (
    releases
      .filter((release) => {
        const version = semver.valid(release.tag_name);
        return (
          !release.draft &&
          version &&
          (channel === "beta" ||
            (!release.prerelease && !semver.prerelease(version))) &&
          semver.gt(version, currentVersion) &&
          releaseAsset(release, "latest.yml") &&
          releaseAsset(release, `PalmierWin-${version}-x64-Setup.exe`)
        );
      })
      .sort((a, b) =>
        semver.rcompare(semver.valid(a.tag_name), semver.valid(b.tag_name)),
      )[0] || null
  );
}

export class UpdateManager {
  constructor({
    version,
    supported,
    portable = false,
    updater = null,
    config = {},
    fetchImpl = fetch,
    persist = async () => {},
    beforeInstall = async () => {},
    onChange = () => {},
  }) {
    Object.assign(this, {
      updater,
      fetchImpl,
      persist,
      beforeInstall,
      onChange,
    });
    this.candidate = null;
    this.state = {
      currentVersion: version,
      channel: channels.has(config.channel)
        ? config.channel
        : semver.prerelease(version)
          ? "beta"
          : "stable",
      automatic: config.automatic !== false,
      supported,
      portable,
      canInstall: supported && !portable && !!updater,
      phase: supported ? "idle" : "unsupported",
      availableVersion: null,
      progress: 0,
      lastChecked: null,
      message: supported
        ? "Check GitHub for updates."
        : "Updates are available in the Windows desktop app.",
    };
    if (updater) {
      // Only the explicit restart action installs; switching channels never installs a cached update.
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.on("download-progress", ({ percent }) => {
        if (this.state.phase === "downloading")
          this.patch({
            progress: Math.max(0, Math.min(100, Number(percent) || 0)),
          });
      });
      updater.on("error", () => {
        if (this.busy)
          this.fail(
            "The update could not be completed. Check your connection and try again.",
          );
      });
    }
  }
  get busy() {
    return ["checking", "downloading", "installing"].includes(this.state.phase);
  }
  snapshot() {
    return { ...this.state };
  }
  patch(value) {
    Object.assign(this.state, value);
    this.onChange(this.snapshot());
    return this.snapshot();
  }
  fail(message) {
    return this.patch({ phase: "error", message });
  }
  async configure({ channel, automatic }) {
    if (!channels.has(channel) || typeof automatic !== "boolean")
      throw new Error(
        "Choose Stable or Beta updates and an automatic-check preference.",
      );
    if (this.busy)
      throw new Error(
        "Wait for the current update operation before changing channels.",
      );
    await this.persist({ channel, automatic });
    if (channel !== this.state.channel) {
      this.candidate = null;
      this.patch({
        phase: this.state.supported ? "idle" : "unsupported",
        availableVersion: null,
        progress: 0,
      });
    }
    this.patch({ channel, automatic, message: "Update preferences saved." });
    if (automatic && this.state.supported && this.state.phase !== "ready")
      void this.check();
    return this.snapshot();
  }
  async check() {
    if (!this.state.supported || this.busy || this.state.phase === "ready")
      return this.snapshot();
    this.candidate = null;
    this.patch({
      phase: "checking",
      message: "Checking GitHub…",
      availableVersion: null,
      progress: 0,
    });
    try {
      const response = await this.fetchImpl(RELEASES_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PalmierWin-Updater",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        if ([403, 429].includes(response.status))
          throw new Error("GitHub is limiting update checks. Try again later.");
        throw new Error(
          "Could not check GitHub for updates. Try again shortly.",
        );
      }
      const releases = await response.json();
      const release = selectRelease(
        releases,
        this.state.currentVersion,
        this.state.channel,
      );
      this.patch({ lastChecked: new Date().toISOString() });
      if (!release) {
        const noStable =
          this.state.channel === "stable" &&
          !releases.some(
            (item) =>
              !item.draft &&
              !item.prerelease &&
              semver.valid(item.tag_name) &&
              !semver.prerelease(item.tag_name),
          );
        return this.patch({
          phase: "current",
          message: noStable
            ? "No stable release is published yet. Choose Beta to receive preview releases."
            : "You're up to date on this channel. Older versions are never installed.",
        });
      }
      this.candidate = release;
      const version = semver.valid(release.tag_name);
      if (this.state.canInstall) {
        this.updater.setFeedURL({
          provider: "generic",
          url: `${RELEASES_PAGE}/download/${encodeURIComponent(release.tag_name)}/`,
          channel: "latest",
          useMultipleRangeRequest: false,
        });
        this.updater.allowPrerelease = this.state.channel === "beta";
        this.updater.allowDowngrade = false;
        const result = await this.updater.checkForUpdates();
        if (
          !result?.updateInfo ||
          !semver.eq(result.updateInfo.version, version)
        )
          throw new Error(
            "The release update information does not match its version. Try again later.",
          );
      }
      this.patch({
        phase: "available",
        availableVersion: version,
        message: `Version ${version} is available.`,
      });
      if (this.state.automatic && this.state.canInstall)
        return await this.download();
      return this.snapshot();
    } catch (error) {
      return this.fail(
        error.name === "TimeoutError"
          ? "The GitHub update check timed out. Try again shortly."
          : error.message || "Could not check for updates.",
      );
    }
  }
  async download() {
    if (
      this.state.phase !== "available" ||
      !this.state.canInstall ||
      !this.candidate
    )
      throw new Error("Check for an available installer update first.");
    this.patch({
      phase: "downloading",
      progress: 0,
      message: "Downloading and verifying the update…",
    });
    try {
      await this.updater.downloadUpdate();
      if (this.state.phase === "error") return this.snapshot();
      return this.patch({
        phase: "ready",
        progress: 100,
        message:
          "Update ready. Restart to install; your current project will be recovered.",
      });
    } catch {
      return this.fail(
        "The update download or verification failed. Check your connection and try again.",
      );
    }
  }
  portableDownload() {
    if (
      !this.state.portable ||
      this.state.phase !== "available" ||
      !this.candidate
    )
      throw new Error("Check for an available portable update first.");
    const url = releaseAsset(
      this.candidate,
      `PalmierWin-${this.state.availableVersion}-x64-Portable.exe`,
    );
    if (!url)
      throw new Error(
        "This release has no portable download. Use the installer edition for automatic installation.",
      );
    return url;
  }
  async install() {
    if (this.state.phase !== "ready" || !this.state.canInstall)
      throw new Error("Download and verify an update before installing it.");
    await this.beforeInstall();
    this.patch({
      phase: "installing",
      message: "Restarting to install the update…",
    });
    this.updater.quitAndInstall(true, true);
    return this.snapshot();
  }
  start() {
    if (!this.state.supported) return;
    this.startupTimer = setTimeout(() => {
      if (this.state.automatic) void this.check();
    }, 10000);
    this.interval = setInterval(
      () => {
        if (this.state.automatic) void this.check();
      },
      6 * 60 * 60 * 1000,
    );
    this.startupTimer.unref?.();
    this.interval.unref?.();
  }
  stop() {
    clearTimeout(this.startupTimer);
    clearInterval(this.interval);
  }
}
