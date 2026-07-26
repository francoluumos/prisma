import "./style.css";
import { initSite } from "./site";
import { initConfigurator, initConfigBar, initModals } from "./configurator";

/* Shared site choreography (nav, reveals, hero tilt, reserve form, parallax). */
initSite();

/* Configurator, fixed checkout bar, and size/geometry dialogs. */
initConfigurator();
initConfigBar();
initModals();
