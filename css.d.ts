// TypeScript 7 reports TS2882 for a side-effect import of a file it cannot
// resolve to a module, such as `import "./globals.css"` in app/layout.tsx.
// Next.js declares `*.css` in its own global types, but an ambient wildcard
// module does not apply to a relative specifier, so the declaration must live
// in the project.
//
// The more specific `*.module.css` declaration in next/types/global.d.ts still
// wins for CSS Modules, which keeps their typed `styles` object.
declare module "*.css";
