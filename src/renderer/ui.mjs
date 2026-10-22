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
  element.textContent = message;
  $("#toasts").append(element);
  setTimeout(() => element.remove(), error ? 6500 : 3200);
}
export function modal(title, body, footer = "") {
  const dialog = $("#modal");
  $("#modal-content").innerHTML =
    `<header class="modal-header"><h2>${title}</h2><button class="icon-button" data-close aria-label="Close dialog">${icon("x")}</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}`;
  for (const button of dialog.querySelectorAll("[data-close]"))
    button.onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
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
  element.classList.remove("hidden");
  element.style.left = `${Math.min(event.clientX, innerWidth - element.offsetWidth - 10)}px`;
  element.style.top = `${Math.min(event.clientY, innerHeight - element.offsetHeight - 10)}px`;
  element.onclick = (event) => {
    const button = event.target.closest("[data-context]");
    if (button) {
      element.classList.add("hidden");
      Promise.resolve()
        .then(items[+button.dataset.context].run)
        .catch((e) => toast(e.message, true));
    }
  };
}
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#context-menu"))
    $("#context-menu").classList.add("hidden");
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
