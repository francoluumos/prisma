/* ----------------------------------------------------------------
   Assistant UI — fit chat (with voice) + inspiration → colourway.

   Degrades gracefully: if the backend env isn't set, the panel shows a note and
   disables sending; the rest of the Beta studio keeps working. Voice uses the
   Web Speech API and hides itself where unsupported.
   ---------------------------------------------------------------- */
import { askFit, assistantConfigured, readPalette, type ChatMessage, type Recommendation } from "./client";
import { applyColourway, applyRecommendation } from "./apply";

export function initAssistant(): void {
  const root = document.querySelector<HTMLElement>("[data-assistant]");
  if (!root) return;

  const configured = assistantConfigured();
  const hint = root.querySelector<HTMLElement>("[data-assistant-hint]");
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  /* --------------------------- fit chat --------------------------- */
  const chatForm = $("[data-chat-form]") as HTMLFormElement | null;
  const chatInput = $("[data-chat-input]") as HTMLInputElement | null;
  const chatLog = $("[data-chat-log]");
  const recEl = $("[data-rec]");
  const sendBtn = chatForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const messages: ChatMessage[] = [];

  const rider = () => ({
    heightCm: num("[data-rider-height]"),
    inseamCm: num("[data-rider-inseam]"),
    level: val("[data-rider-level]"),
    style: val("[data-rider-style]"),
  });
  const num = (s: string) => {
    const v = ($(s) as HTMLInputElement | null)?.value;
    return v ? Number(v) : undefined;
  };
  const val = (s: string) => ($(s) as HTMLInputElement | null)?.value || undefined;

  const addMsg = (role: "user" | "assistant", text: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = `assistant__msg assistant__msg--${role}`;
    el.textContent = text;
    chatLog?.appendChild(el);
    chatLog?.scrollTo({ top: chatLog.scrollHeight });
    return el;
  };

  const showRec = (rec: Recommendation) => {
    if (!recEl) return;
    const alt = rec.alternativeSize ? ` · alt ${rec.alternativeSize}` : "";
    recEl.innerHTML = "";
    const summary = document.createElement("p");
    summary.className = "assistant__rec-line";
    summary.textContent = `${rec.size}${alt} · ${rec.drivetrain}${rec.pedals && rec.pedals !== "No pedals" ? " · " + rec.pedals : ""} · ${rec.colour}`;
    const why = document.createElement("p");
    why.className = "assistant__rec-why mono";
    why.textContent = rec.rationale;
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "assistant__send";
    apply.textContent = "Apply this build";
    apply.addEventListener("click", () => {
      applyRecommendation(rec);
      document.querySelector("#configure")?.scrollIntoView({ behavior: "smooth" });
    });
    recEl.append(summary, why, apply);
    recEl.hidden = false;
  };

  let busy = false;
  const ask = async (text: string) => {
    if (busy || !text.trim()) return;
    busy = true;
    if (sendBtn) sendBtn.disabled = true;
    addMsg("user", text);
    messages.push({ role: "user", content: text });
    const out = addMsg("assistant", "");
    let acc = "";
    try {
      await askFit(
        { rider: rider(), messages },
        {
          onText: (d) => {
            acc += d;
            out.textContent = acc;
            chatLog?.scrollTo({ top: chatLog.scrollHeight });
          },
          onRecommendation: (rec) => showRec(rec),
        }
      );
      messages.push({ role: "assistant", content: acc });
    } catch (err) {
      out.textContent = err instanceof Error ? err.message : "Something went wrong.";
    } finally {
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  };

  chatForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!chatInput) return;
    const text = chatInput.value;
    chatInput.value = "";
    void ask(text);
  });

  /* ----------------------------- voice ---------------------------- */
  wireVoice(root, chatInput);

  /* ------------------------- inspiration -------------------------- */
  wireInspiration(root);

  /* --------------------- not-configured state --------------------- */
  if (!configured) {
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
      "input, button, select, textarea"
    ).forEach((el) => {
      if (!el.hasAttribute("data-rider-height")) el.disabled = true;
    });
    if (hint) hint.textContent = "The fit assistant comes online once the studio backend is connected.";
  } else if (hint) {
    hint.textContent = "Answers are guidance — we confirm your fit before anything ships.";
  }
}

/* ============================ voice ============================== */
function wireVoice(root: HTMLElement, input: HTMLInputElement | null): void {
  const mic = root.querySelector<HTMLButtonElement>("[data-mic]");
  if (!mic || !input) return;
  // deno-lint-ignore no-explicit-any
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return; // unsupported → leave the mic hidden

  mic.hidden = false;
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let listening = false;
  let baseline = "";

  rec.addEventListener("result", (e: { results: ArrayLike<{ 0: { transcript: string } }> }) => {
    let transcript = "";
    for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
    input.value = (baseline + " " + transcript).trim();
  });
  rec.addEventListener("end", () => {
    listening = false;
    mic.classList.remove("is-live");
    input.focus();
  });

  mic.addEventListener("click", () => {
    if (listening) {
      rec.stop();
      return;
    }
    baseline = input.value;
    try {
      rec.start();
      listening = true;
      mic.classList.add("is-live");
    } catch {
      /* start() throws if already running — ignore */
    }
  });
}

/* ========================= inspiration ========================== */
function wireInspiration(root: HTMLElement): void {
  const drop = root.querySelector<HTMLElement>("[data-drop]");
  const filesInput = root.querySelector<HTMLInputElement>("[data-inspo-files]");
  const thumbs = root.querySelector<HTMLElement>("[data-inspo-thumbs]");
  const note = root.querySelector<HTMLInputElement>("[data-inspo-note]");
  const go = root.querySelector<HTMLButtonElement>("[data-inspo-go]");
  const paletteEl = root.querySelector<HTMLElement>("[data-palette]");
  if (!drop || !filesInput || !thumbs || !go || !paletteEl) return;

  let files: File[] = [];
  const renderThumbs = () => {
    thumbs.innerHTML = "";
    files.forEach((f) => {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      img.alt = f.name;
      img.addEventListener("load", () => URL.revokeObjectURL(img.src));
      li.appendChild(img);
      thumbs.appendChild(li);
    });
  };
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    files = [...files, ...Array.from(list).filter((f) => f.type.startsWith("image/"))].slice(0, 3);
    renderThumbs();
  };

  drop.addEventListener("click", () => filesInput.click());
  filesInput.addEventListener("change", () => addFiles(filesInput.files));
  ["dragover", "dragenter"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
    })
  );
  drop.addEventListener("drop", (e) => addFiles((e as DragEvent).dataTransfer?.files ?? null));

  go.addEventListener("click", async () => {
    if (!files.length) {
      paletteEl.hidden = false;
      paletteEl.textContent = "Add an inspiration image first.";
      return;
    }
    go.disabled = true;
    paletteEl.hidden = false;
    paletteEl.textContent = "Reading your inspiration…";
    try {
      const result = await readPalette(files, note?.value || undefined);
      paletteEl.innerHTML = "";
      const reply = document.createElement("p");
      reply.className = "assistant__rec-why mono";
      reply.textContent = result.reply;
      const row = document.createElement("ul");
      row.className = "assistant__swatch-row";
      for (const sw of result.palette) {
        const li = document.createElement("li");
        li.style.setProperty("--swatch", sw.hex);
        li.title = `${sw.name} · ${sw.role}`;
        row.appendChild(li);
      }
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "assistant__send";
      apply.textContent = "Apply to bike";
      apply.addEventListener("click", () => {
        applyColourway(result.suggested);
        document.querySelector("#configure")?.scrollIntoView({ behavior: "smooth" });
      });
      paletteEl.append(reply, row, apply);
    } catch (err) {
      paletteEl.textContent = err instanceof Error ? err.message : "Couldn't read that.";
    } finally {
      go.disabled = false;
    }
  });
}
