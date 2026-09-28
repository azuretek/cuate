// Base class for every component: light DOM, so the token and app stylesheets reach it directly.
// Whether the framework moves to shadow DOM is still open (the plan's phase 3 decides it by measurement).
import { LitElement } from './lit.js';

export class KitElement extends LitElement {
  createRenderRoot() {
    return this;
  }
}
