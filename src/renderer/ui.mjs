import { icon } from "./icons.mjs";
export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function timecode(frame, fps) {
  frame = Math.max(0, Math.floor(frame));
  const s = Math.floor(frame / fps);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, frame % fps]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export function shortTime(frame, fps) {
  const s = Math.floor(frame / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function toast(message, error = false) {
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  const text = document.createElement("span");
  text.textContent = message;
  element.append(text);
  if (error) {
    element.setAttribute("role", "alert");
    const dismiss = document.createElement("button");
    dismiss.className = "toast-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss error");
    dismiss.innerHTML = icon("x");
    dismiss.onclick = () => element.remove();
    element.append(dismiss);
  }
  $("#toasts").append(element);
  if (!error) setTimeout(() => element.remove(), 3200);
}
export function modal(title, body, footer = "") {
  const dialog = $("#modal");
  dialog.classList.remove("settings-dialog");
  const opener = dialog.open ? null : document.activeElement;
  dialog.setAttribute("aria-labelledby", "modal-title");
  $("#modal-content").innerHTML =
    `<header class="modal-header"><h2 id="modal-title">${title}</h2><button class="icon-button" data-close aria-label="Close dialog">${icon("x")}</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}`;
  for (const button of dialog.querySelectorAll("[data-close]"))
    button.onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
  const initial = dialog.querySelector(
    "[autofocus], .modal-body input:not([disabled]):not([type=checkbox]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])",
  );
  initial?.focus({ preventScroll: true });
  if (opener)
    dialog.addEventListener(
      "close",
      () => {
        if (opener.isConnected) opener.focus({ preventScroll: true });
      },
      { once: true },
    );
  return dialog;
}
export async function ask(title, label, initial = "") {
  return new Promise((resolve) => {
    const dialog = modal(
      esc(title),
      `<form id="prompt-form"><label class="form-field"><span>${esc(label)}</span><input id="prompt-input" value="${esc(initial)}" maxlength="2000" autocomplete="off" required></label></form>`,
      `<button class="quiet-button" data-close>Cancel</button><button class="primary-button" type="submit" form="prompt-form">Save</button>`,
    );
    let result = null;
    $("#prompt-form").onsubmit = (event) => {
      event.preventDefault();
      result = $("#prompt-input").value;
      dialog.close();
    };
    dialog.addEventListener("close", () => resolve(result), { once: true });
    setTimeout(() => {
      $("#prompt-input")?.focus();
      $("#prompt-input")?.select();
    }, 20);
  });
}
export async function confirmAction(title, message, action = "Continue") {
  return new Promise((resolve) => {
    const dialog = modal(
      esc(title),
      `<p>${esc(message)}</p>`,
      `<button class="quiet-button" data-close>Cancel</button><button class="primary-button" id="confirm-action">${esc(action)}</button>`,
    );
    let result = false;
    $("#confirm-action").onclick = () => {
      result = true;
      dialog.close();
    };
    dialog.addEventListener("close", () => resolve(result), { once: true });
  });
}
const menuOpeners = new WeakMap();
const initializedMenus = new WeakSet();
export function closeMenu(menu, restoreFocus = false) {
  if (menu.classList.contains("hidden")) return;
  menu.classList.add("hidden");
  const previous = menuOpeners.get(menu);
  const opener = previous?.isConnected
    ? previous
    : previous?.dataset.clip
      ? $(`[data-clip="${CSS.escape(previous.dataset.clip)}"]`)
      : previous?.dataset.media
        ? $(`[data-media="${CSS.escape(previous.dataset.media)}"]`)
        : null;
  if (opener?.hasAttribute("aria-haspopup"))
    opener.setAttribute("aria-expanded", "false");
  if (restoreFocus && opener?.isConnected)
    opener.focus({ preventScroll: true });
}
export function openMenu(menu, opener) {
  for (const other of $$('[role="menu"]')) {
    if (other !== menu) closeMenu(other);
  }
  menuOpeners.set(menu, opener);
  if (opener?.hasAttribute("aria-haspopup"))
    opener.setAttribute("aria-expanded", "true");
  menu.classList.remove("hidden");
  const items = [...menu.querySelectorAll("button")];
  for (const item of items) {
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
  }
  items.find((item) => !item.disabled)?.focus({ preventScroll: true });
  if (initializedMenus.has(menu)) return;
  initializedMenus.add(menu);
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll("button:not(:disabled)")];
    const index = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[next]?.focus({ preventScroll: true });
    } else if (["Escape", "Tab"].includes(event.key)) {
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation();
      closeMenu(menu, true);
    } else if (
      event.key.length === 1 &&
      event.key.trim() &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      ordered
        .find((item) =>
          item.textContent
            .trim()
            .toLocaleLowerCase()
            .startsWith(event.key.toLocaleLowerCase()),
        )
        ?.focus();
    }
  });
}
export function showContext(event, items) {
  event.preventDefault();
  const element = $("#context-menu");
  element.innerHTML = items
    .map((item, i) =>
      item === null
        ? "<hr>"
        : `<button role="menuitem" data-context="${i}" ${item.disabled ? "disabled" : ""} class="${item.danger ? "text-danger" : ""}">${item.icon ? icon(item.icon) : ""}${esc(item.label)}</button>`,
    )
    .join("");
  openMenu(
    element,
    event.target.closest("[tabindex],button") || document.activeElement,
  );
  element.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - element.offsetWidth - 10))}px`;
  element.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - element.offsetHeight - 10))}px`;
  element.onclick = (event) => {
    const button = event.target.closest("[data-context]");
    if (button) {
      closeMenu(element, true);
      Promise.resolve()
        .then(items[+button.dataset.context].run)
        .catch((e) => toast(e.message, true));
    }
  };
}
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#context-menu")) closeMenu($("#context-menu"));
});
$("#modal").addEventListener("click", (event) => {
  if (event.target === $("#modal")) {
    const r = event.target.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      event.target.close();
  }
});
