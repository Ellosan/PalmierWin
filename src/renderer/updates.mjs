import { $, esc } from "./ui.mjs";

export async function mountUpdates(bridge) {
  const root = document.createElement("section");
  root.className = "update-settings";
  root.setAttribute("aria-labelledby", "updates-heading");
  const form = $("#settings-form");
  form.querySelector("#settings-updates").append(root);
  const initial = await bridge.updates();
  if (!root.isConnected) return;
  root.innerHTML = `<div class="updates-heading"><h3 id="updates-heading">App updates</h3><span>Version ${esc(initial.currentVersion)}</span></div>
    <div class="form-field"><label for="update-channel">Update channel</label><select id="update-channel"><option value="stable">Release — Latest · Stable</option><option value="beta">Pre-Release — Beta</option></select></div>
    <p class="browser-note">Stable receives published releases. Beta also receives pre-release versions. Switching channels never installs an older version.</p>
    <label class="update-automatic"><input id="update-automatic" type="checkbox"> Check automatically${initial.canInstall ? " and download in the background" : ""}</label>
    ${initial.portable ? '<p class="browser-note">Portable edition: new versions download through your browser. Use the installer edition for automatic installation.</p>' : ""}
    <p id="update-status" class="update-status" role="status" aria-live="polite"></p>
    <div id="update-progress-wrap" class="hidden"><progress id="update-progress" max="100" value="0" aria-label="Update download progress"></progress><span id="update-percent" aria-hidden="true"></span></div>
    <div class="update-actions"><button type="button" class="secondary-button" id="check-updates">Check now</button><button type="button" class="secondary-button hidden" id="download-update">${initial.portable ? "Download portable" : "Download update"}</button><button type="button" class="primary-button hidden" id="install-update">Restart and install</button><button type="button" class="quiet-button" id="view-releases">GitHub releases ↗</button></div>
    <p id="update-error" class="inline-error" role="alert"></p>`;
  const find = (selector) => root.querySelector(selector);
  function render(state) {
    if (!root.isConnected) return;
    const busy = ["checking", "downloading", "installing"].includes(
      state.phase,
    );
    find("#update-channel").value = state.channel;
    find("#update-automatic").checked = state.automatic;
    find("#update-channel").disabled = !state.supported || busy;
    find("#update-automatic").disabled = !state.supported || busy;
    find("#check-updates").disabled =
      !state.supported || busy || state.phase === "ready";
    find("#check-updates").textContent =
      state.phase === "checking" ? "Checking…" : "Check now";
    const status = find("#update-status");
    if (status.textContent !== state.message)
      status.textContent = state.message;
    find("#update-progress-wrap").classList.toggle(
      "hidden",
      state.phase !== "downloading",
    );
    find("#update-progress").value = state.progress || 0;
    find("#update-percent").textContent = `${Math.round(state.progress || 0)}%`;
    find("#download-update").classList.toggle(
      "hidden",
      state.phase !== "available",
    );
    find("#install-update").classList.toggle("hidden", state.phase !== "ready");
    find("#view-releases").disabled = !bridge.desktop;
  }
  async function action(fn) {
    find("#update-error").textContent = "";
    try {
      render(await fn());
    } catch (error) {
      if (root.isConnected) find("#update-error").textContent = error.message;
      render(await bridge.updates());
    }
  }
  const configure = () =>
    action(() =>
      bridge.configureUpdates({
        channel: find("#update-channel").value,
        automatic: find("#update-automatic").checked,
      }),
    );
  find("#update-channel").onchange = configure;
  find("#update-automatic").onchange = configure;
  find("#check-updates").onclick = () => action(() => bridge.checkUpdates());
  find("#download-update").onclick = () =>
    action(() => bridge.downloadUpdate());
  find("#install-update").onclick = () => action(() => bridge.installUpdate());
  find("#view-releases").onclick = () => bridge.openReleases();
  render(initial);
  const unsubscribe = bridge.onUpdate?.(render);
  $("#modal").addEventListener("close", () => unsubscribe?.(), { once: true });
}
