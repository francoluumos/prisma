/* ----------------------------------------------------------------
   Cookie consent — a lightweight banner shown until the visitor chooses.

   Injected by JS (so no markup is duplicated across pages) and wired from
   site.ts, so every page gets it. The choice is stored in localStorage; clear
   site storage to see the banner again. This only records the preference — hook
   any actual analytics/marketing scripts to `getConsent() === "all"`.
   ---------------------------------------------------------------- */
const KEY = "prisma-cookie-consent";

export function getConsent(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function initCookieConsent(): void {
  if (getConsent()) return;

  const banner = document.createElement("div");
  banner.className = "cookie";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Cookie notice");
  banner.innerHTML = `
    <div class="cookie__inner shell">
      <p class="cookie__text">We use cookies to run this site and, with your consent, to understand and improve it. See our <a href="/cookies.html">Cookie&nbsp;Policy</a>.</p>
      <div class="cookie__actions">
        <button type="button" class="cookie__btn cookie__btn--ghost" data-cookie-necessary>Necessary only</button>
        <button type="button" class="cookie__btn cookie__btn--solid" data-cookie-accept>Accept all</button>
      </div>
    </div>`;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add("is-visible"));

  const decide = (choice: "all" | "necessary") => {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* storage blocked — banner still dismisses for the session */
    }
    banner.classList.remove("is-visible");
    banner.addEventListener("transitionend", () => banner.remove(), { once: true });
    // Fallback removal if no transition fires (reduced motion).
    window.setTimeout(() => banner.remove(), 500);
  };

  banner.querySelector("[data-cookie-accept]")?.addEventListener("click", () => decide("all"));
  banner.querySelector("[data-cookie-necessary]")?.addEventListener("click", () => decide("necessary"));
}
