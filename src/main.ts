import "./style.css";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/* ----------------------------------------------------------------
   Nav: hairline + denser glass once scrolled
   ---------------------------------------------------------------- */
const nav = document.querySelector<HTMLElement>("[data-nav]");
const onScrollNav = () => {
  if (!nav) return;
  nav.toggleAttribute("data-scrolled", window.scrollY > 8);
};
onScrollNav();
window.addEventListener("scroll", onScrollNav, { passive: true });

/* ----------------------------------------------------------------
   Reveal on enter — choreographed but never gates visibility
   ---------------------------------------------------------------- */
const reveals = document.querySelectorAll<HTMLElement>("[data-reveal]");
if (reduceMotion || !("IntersectionObserver" in window)) {
  // Leave content in its visible default state; no gate, no animation.
} else {
  // Opt in to the hidden start state only now that we can drive the reveal.
  document.documentElement.classList.add("anim-ready");
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );
  reveals.forEach((el) => io.observe(el));
}

/* ----------------------------------------------------------------
   Hero bike: subtle pointer-driven tilt for depth.
   Settles to rest and stops the loop when idle or off-screen.
   ---------------------------------------------------------------- */
const tiltStage = document.querySelector<HTMLElement>("[data-tilt]");
const tiltTarget = document.querySelector<HTMLElement>("[data-tilt-target]");

if (!reduceMotion && tiltStage && tiltTarget) {
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let raf = 0;
  let running = false;
  let onScreen = true;

  const tick = () => {
    cx = lerp(cx, tx, 0.08);
    cy = lerp(cy, ty, 0.08);
    tiltTarget.style.transform =
      `translate3d(${(cx * 14).toFixed(2)}px, ${(cy * 10).toFixed(2)}px, 0) rotate(${(cx * 0.7).toFixed(3)}deg)`;
    if (onScreen && (Math.abs(cx - tx) > 0.0008 || Math.abs(cy - ty) > 0.0008)) {
      raf = requestAnimationFrame(tick);
    } else {
      running = false;
    }
  };
  const start = () => {
    if (!running && onScreen) {
      running = true;
      raf = requestAnimationFrame(tick);
    }
  };

  const hero = tiltStage.closest(".hero") ?? document.body;
  hero.addEventListener(
    "pointermove",
    (e: Event) => {
      const pe = e as PointerEvent;
      const r = tiltStage.getBoundingClientRect();
      tx = clamp(((pe.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
      ty = clamp(((pe.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
      start();
    },
    { passive: true }
  );
  hero.addEventListener("pointerleave", () => {
    tx = 0;
    ty = 0;
    start();
  });

  if ("IntersectionObserver" in window) {
    const vis = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onScreen = entry.isIntersecting;
          if (!onScreen && raf) {
            cancelAnimationFrame(raf);
            raf = 0;
            running = false;
          }
        }
      },
      { threshold: 0.01 }
    );
    vis.observe(tiltStage);
  }
}

/* ----------------------------------------------------------------
   Reserve form — full state machine
   idle → invalid → submitting → success
   ---------------------------------------------------------------- */
const form = document.querySelector<HTMLFormElement>("[data-reserve-form]");
const field = form?.querySelector<HTMLElement>(".field");
const input = form?.querySelector<HTMLInputElement>("#email");
const msg = form?.querySelector<HTMLElement>("[data-msg]");
const submit = form?.querySelector<HTMLButtonElement>("[data-submit]");
const submitLabel = submit?.querySelector<HTMLElement>(".field__submit-label");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const setState = (state: "idle" | "invalid" | "success", message = "") => {
  if (!field || !msg) return;
  field.classList.toggle("is-invalid", state === "invalid");
  field.classList.toggle("is-success", state === "success");
  msg.textContent = message;
  if (input) input.setAttribute("aria-invalid", String(state === "invalid"));
};

// clear the error as soon as the user starts correcting it
input?.addEventListener("input", () => {
  if (field?.classList.contains("is-invalid")) setState("idle");
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!input || !submit || !submitLabel) return;

  const value = input.value.trim();
  if (!value) {
    setState("invalid", "Enter your email to reserve a piece.");
    input.focus();
    return;
  }
  if (!EMAIL_RE.test(value)) {
    setState("invalid", "That doesn't look like a valid email.");
    input.focus();
    return;
  }

  // submitting
  setState("idle", "");
  submit.setAttribute("data-loading", "");
  submit.setAttribute("aria-busy", "true");
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  submitLabel.replaceChildren(spinner);

  // simulate a network reservation
  window.setTimeout(() => {
    submit.removeAttribute("data-loading");
    submit.removeAttribute("aria-busy");
    submitLabel.textContent = "Reserved";
    input.value = "";
    input.disabled = true;
    setState("success", `You're on the list. We'll email ${value} before it ships.`);
  }, 1100);
});

/* ----------------------------------------------------------------
   Scroll: progress line + cover-image parallax (object-position pan)
   ---------------------------------------------------------------- */
const progress = document.querySelector<HTMLElement>("[data-progress]");
const parallaxEls = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
let scrollTicking = false;

const onScroll = () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
    if (progress) progress.style.setProperty("--p", p.toFixed(4));

    if (!reduceMotion) {
      for (const el of parallaxEls) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const frac = clamp(
          (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight,
          -1,
          1
        );
        // pan the cover crop ~±8% — parallax with no edge gaps
        el.style.objectPosition = `50% ${(50 - frac * 8).toFixed(2)}%`;
      }
    }
    scrollTicking = false;
  });
};
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll, { passive: true });
onScroll();

/* ----------------------------------------------------------------
   Subtle magnetic pull on the primary CTAs
   ---------------------------------------------------------------- */
if (!reduceMotion) {
  document.querySelectorAll<HTMLElement>(".btn--solid").forEach((btn) => {
    btn.addEventListener(
      "pointermove",
      (e) => {
        const pe = e as PointerEvent;
        const r = btn.getBoundingClientRect();
        const mx = (pe.clientX - r.left) / r.width - 0.5;
        const my = (pe.clientY - r.top) / r.height - 0.5;
        btn.style.transform = `translate(${(mx * 6).toFixed(1)}px, ${(my * 5 - 2).toFixed(1)}px)`;
      },
      { passive: true }
    );
    btn.addEventListener("pointerleave", () => {
      btn.style.transform = "";
    });
  });
}

/* ----------------------------------------------------------------
   Configurator — pick a shift unit + colour, update price + summary.
   Prices are base + CHF 400 warehouse fee + CHF 59 Swiss delivery (data-price).
   ---------------------------------------------------------------- */
const configForm = document.querySelector<HTMLFormElement>("[data-configure]");
if (configForm) {
  const totalEl = configForm.querySelector<HTMLElement>("[data-total]");
  const summaryEl = configForm.querySelector<HTMLElement>("[data-summary]");
  const fmt = (n: number) => "CHF " + n.toLocaleString("en-US").replace(/,/g, "'");
  const update = () => {
    // The priced choice is whichever checked radio carries a data-price.
    const priced = configForm.querySelector<HTMLInputElement>("input[data-price]:checked");
    const checked = Array.from(
      configForm.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')
    );
    if (priced && totalEl) totalEl.textContent = fmt(Number(priced.dataset.price || 0));
    if (summaryEl) summaryEl.textContent = checked.map((i) => i.value).join(" · ");
  };
  configForm.addEventListener("change", update);
  update();
}

/* ----------------------------------------------------------------
   Size guide + geometry — open a chart in a native <dialog>.
   Closes on the ✕, on a backdrop click, or Esc (native).
   ---------------------------------------------------------------- */
function wireModal(modalAttr: string, openAttr: string, closeAttr: string): void {
  const modal = document.querySelector<HTMLDialogElement>(`[${modalAttr}]`);
  if (!modal || typeof modal.showModal !== "function") return;

  document.querySelectorAll<HTMLButtonElement>(`[${openAttr}]`).forEach((btn) => {
    btn.addEventListener("click", () => modal.showModal());
  });
  modal.querySelector<HTMLButtonElement>(`[${closeAttr}]`)?.addEventListener("click", () => modal.close());
  // Click on the backdrop (outside the inner card) closes the dialog.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.close();
  });
}

wireModal("data-size-modal", "data-size-guide", "data-size-close");
wireModal("data-geo-modal", "data-geo-guide", "data-geo-close");
