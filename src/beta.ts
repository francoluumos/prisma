import "./style.css";
import { initSite } from "./site";
import { initConfigurator, initConfigBar, initModals } from "./configurator";
import { initStudio } from "./paint/studio";

/* ----------------------------------------------------------------
   Beta "Studio" page entry.

   Reuses the exact site choreography and configurator from the live pages,
   then layers the Beta-only features on top:
     • Stage 2 — the canvas paint engine (frame + wheel recolour)
     • Stage 4 — the Gemini fit/inspiration assistant + voice input
   Those are wired in as they land so this page degrades gracefully to the
   shared configurator if a feature or its assets are unavailable.
   ---------------------------------------------------------------- */

initSite();
initConfigurator();
initConfigBar();
initModals();

/* Stage 2 — the canvas paint engine (frame + wheel recolour). Progressive:
   no-ops back to the curated image swap if unsupported or assets fail. */
void initStudio();
