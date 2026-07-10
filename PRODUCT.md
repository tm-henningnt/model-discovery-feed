# Product

## Register

brand

## Users

Open-source evaluators: engineers skimming the repository to judge its quality, credibility, and whether it's worth adopting, consuming, or contributing to. They arrive from a link, a search, or a package page with a skeptical, time-boxed mindset — they want to grasp what the Model Discovery Feed is, why it exists, and whether the implementation is serious within the first screen. Secondary audiences are developers deciding whether to implement the feed contract in their own stack and AI/LLM app builders who need a normalized way to discover models across providers.

The primary human-facing surface is the landing/home page. There is no application UI today; a feed explorer (browsing live models, providers, and status over the `/v1` endpoints) is a likely later surface. PRODUCT.md defaults to `brand` because the landing page is where design carries the most weight; a future explorer surface can be treated as `product` per task.

## Product Purpose

The Model Discovery Feed is a provider-agnostic contract for publishing and consuming LLM model discovery data — models, capabilities, providers, pricing, and status — as versioned JSON. This repository is the reference Next.js + Prisma implementation: it shows how to publish the feed, validate fixtures, and expose the contract over HTTP (`/v1/schema`, `/v1/feed`, `/v1/status`, `/v1/models`, `/v1/providers`).

It is explicitly **not** an inference proxy, a model router, or a credential store. Success is an evaluator understanding the contract and trusting the implementation quickly enough to adopt it, build a client against it, or contribute — without the landing page overselling or obscuring what the project is.

## Brand Personality

Precise, credible, technical. The voice is that of a well-run specification or standard, not a startup pitch: exact language, no marketing fluff, confidence expressed through rigor rather than adjectives. It should read as built by people who care about correctness — clear structure, honest about scope (including what it is *not*), and respectful of a technical reader's time. Warmth, if any, comes from clarity and craft, not friendliness for its own sake.

## Anti-references

- **Generic AI-SaaS**: purple/indigo gradients, glassmorphism, a centered hero over three identical feature cards, emoji-as-icons, gradient heading text. The default "AI startup" look.
- **Cream + serif "tasteful"**: the warm-neutral body background, big display serif, and sage/olive accent editorial default that has become its own AI cliché.
- **Corporate enterprise**: stock photography, navy-and-gray palette, vague value-prop copy, the anonymous enterprise-vendor site.
- **Cluttered docs portal**: a dense, link-heavy, low-hierarchy documentation dump with no visual point of view — walls of links standing in for a designed page.

## Design Principles

- **Show the contract, don't sell it.** Prove the project is real with concrete artifacts — actual endpoints, real JSON, exact field names — rather than benefit-claim copy.
- **Precision is the aesthetic.** Rigor, alignment, and exact typography carry the credibility; a technical audience reads sloppiness as unreliability.
- **Be honest about scope.** State plainly what the feed is and what it is not; the "is not" list is a trust signal, not a disclaimer to hide.
- **Respect a skeptical, time-boxed reader.** The first screen must answer what/why/is-it-serious before any scrolling.
- **Distinct, not decorated.** A committed visual voice that avoids every anti-reference lane — earned through structure and restraint, not effects.

## Accessibility & Inclusion

No formal compliance target is required. Hold to sensible baselines regardless: readable contrast (aim for WCAG AA-level legibility, never light-gray body text on a tint), full keyboard operability, semantic structure, and a `prefers-reduced-motion` alternative for any motion. Keep any color-carried meaning also distinguishable without color.
