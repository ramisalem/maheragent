# Accessibility-tree-first perception, with coordinate-vision fallback

We must choose how the agent perceives and addresses elements on a page. We make the **accessibility tree** the primary model: `describe` returns interactable elements annotated with role, name, and a stable **Element Ref**, and interaction tools target a Ref. Screenshot-plus-coordinate targeting is kept as a first-class **fallback** for cases the a11y tree can't express (canvas, custom-drawn UI, drift). We rejected a vision-first (screenshot + x,y only) primary because coordinates drift with reflow and are imprecise on dense layouts, and a raw-DOM/CSS-selector primary because it is brittle and less natural for an LLM to drive.

## Consequences

- Interaction is robust and LLM-ergonomic by default, with an escape hatch for non-semantic UI.
- The accessibility/computed-style data gathered for perception doubles as the Grounding evidence for Conformance Checks.
