/* ----------------------------------------------------------------
   Configurator — shared behaviour for the "Build yours" panel.

   Lifted verbatim from main.ts so both the live pages (index/gravel) and the
   new Beta page drive the same price/summary/colour-swap logic, the same fixed
   checkout bar, and the same size/geometry dialogs. Everything is DOM-guarded,
   so calling these on a page that lacks the markup is a no-op.

   Beta layers extra behaviour (the canvas paint engine, the AI assistant) by
   listening to the SAME form's `change` events — it does not need to modify
   anything here.
   ---------------------------------------------------------------- */

/** Pick a shift unit + colour, update price + summary, swap the colour preview.
 *  Prices are base + CHF 400 warehouse fee + CHF 59 Swiss delivery (data-price). */
export function initConfigurator(): void {
  const configForm = document.querySelector<HTMLFormElement>("[data-configure]");
  if (!configForm) return;

  // The checkout bar lives outside the form (so the reveal transform can't
  // capture its fixed positioning), so its cells are queried from the document.
  const totalEl = document.querySelector<HTMLElement>("[data-total]");
  const summaryEl = document.querySelector<HTMLElement>("[data-summary]");
  const previewEl = configForm.querySelector<HTMLImageElement>("[data-colour-preview]");
  const previewLabelEl = configForm.querySelector<HTMLElement>("[data-colour-label]");
  const previewFinishEl = configForm.querySelector<HTMLElement>("[data-colour-finish]");
  const productName = configForm.dataset.productName || "Prisma One";
  const fmt = (n: number) => "CHF " + n.toLocaleString("en-US").replace(/,/g, "'");

  // "Reserve this build" → carry the current build into the checkout prototype.
  const checkoutCta = document.querySelector<HTMLAnchorElement>("[data-checkout-cta]");
  const productId = /terra/i.test(productName) ? "terra" : "aero";

  // Discount codes — add real promos here, e.g. { LAUNCH10: 0.1 } for 10% off.
  const CODES: Record<string, number> = {};
  let discountRate = 0;

  const update = () => {
    // Every choice contributes a value (for the summary) and a price (for the
    // total): checked radios, plus any <select data-variant-select> whose
    // chosen <option> carries a data-price (the Beta page uses dropdowns).
    const checked = Array.from(
      configForm.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')
    );
    const selects = Array.from(
      configForm.querySelectorAll<HTMLSelectElement>("select[data-variant-select]")
    );
    const items = [
      // Finish is a colour-studio attribute shown in the preview caption, not a
      // checkout line item — keep it out of the build summary.
      ...checked
        .filter((i) => i.name !== "finish")
        .map((i) => ({ value: i.value, price: Number(i.dataset.price || 0) })),
      ...selects.map((s) => {
        const opt = s.selectedOptions[0];
        return { value: opt ? opt.value : s.value, price: Number(opt?.dataset.price || 0) };
      }),
    ];
    const base = items.reduce((sum, i) => sum + i.price, 0);
    if (totalEl) {
      const net = Math.round(base * (1 - discountRate));
      totalEl.textContent = fmt(net);
    }
    if (summaryEl) summaryEl.textContent = items.map((i) => i.value).join(" · ");

    // Update the checkout link with the current build (radio-based pages only).
    if (checkoutCta) {
      const byName = (n: string) =>
        configForm.querySelector<HTMLInputElement>(`input[name="${n}"]:checked`)?.value || "";
      const p = new URLSearchParams({ product: productId });
      for (const dim of ["size", "colour", "drivetrain", "pedals"]) {
        const v = byName(dim);
        if (v) p.set(dim, v);
      }
      checkoutCta.href = "/checkout.html?" + p.toString();
    }

    // Swap the left-column preview to the chosen colour.
    const colour = configForm.querySelector<HTMLInputElement>('input[name="colour"]:checked');
    if (colour) {
      if (previewEl && colour.dataset.preview) {
        previewEl.src = colour.dataset.preview;
        previewEl.alt = productName + " in " + colour.value;
      }
      if (previewLabelEl) previewLabelEl.textContent = colour.value;
      if (previewFinishEl && colour.dataset.finish) previewFinishEl.textContent = colour.dataset.finish;
    }
  };
  configForm.addEventListener("change", update);

  // Discount code: apply on click or Enter; recalculates the total.
  const discountInput = document.querySelector<HTMLInputElement>("[data-discount-input]");
  const discountApply = document.querySelector<HTMLButtonElement>("[data-discount-apply]");
  const discountMsg = document.querySelector<HTMLElement>("[data-discount-msg]");
  const applyDiscount = () => {
    const code = (discountInput?.value || "").trim().toUpperCase();
    if (!code) {
      discountRate = 0;
      if (discountMsg) { discountMsg.textContent = ""; discountMsg.removeAttribute("data-state"); }
    } else if (code in CODES) {
      discountRate = CODES[code];
      if (discountMsg) { discountMsg.textContent = "−" + Math.round(discountRate * 100) + "% applied"; discountMsg.dataset.state = "ok"; }
    } else {
      discountRate = 0;
      if (discountMsg) { discountMsg.textContent = "Code not recognised"; discountMsg.dataset.state = "err"; }
    }
    update();
  };
  discountApply?.addEventListener("click", applyDiscount);
  discountInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyDiscount(); }
  });
  // No backend — never let the form navigate away on submit.
  configForm.addEventListener("submit", (e) => e.preventDefault());

  update();
}

/** Fixed checkout bar overlays the page bottom. Reserve its height as
 *  --configbar-h so the footer clears it, and reveal it past "Build yours". */
export function initConfigBar(): void {
  const configBar = document.querySelector<HTMLElement>(".configure__bar");
  if (!configBar) return;

  const setBarHeight = () =>
    document.documentElement.style.setProperty("--configbar-h", configBar.offsetHeight + "px");
  setBarHeight();
  if ("ResizeObserver" in window) new ResizeObserver(setBarHeight).observe(configBar);
  window.addEventListener("resize", setBarHeight);

  // Reveal the bar only once the "Build yours" section is reached, then keep
  // it shown for everything below (hidden again if you scroll back above it).
  const configSection = document.querySelector<HTMLElement>("#configure");
  if (configSection) {
    const syncBar = () => {
      const top = configSection.getBoundingClientRect().top;
      configBar.classList.toggle("is-visible", top <= window.innerHeight * 0.8);
    };
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { syncBar(); ticking = false; });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    syncBar();
  } else {
    configBar.classList.add("is-visible");
  }
}

/** Size guide + geometry — open a chart in a native <dialog>.
 *  Closes on the ✕, on a backdrop click, or Esc (native). */
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

/** Wire the size-guide and geometry dialogs. */
export function initModals(): void {
  wireModal("data-size-modal", "data-size-guide", "data-size-close");
  wireModal("data-geo-modal", "data-geo-guide", "data-geo-close");
}
