# Calmnova Code V1 UI architecture

Visual source: `/Users/huangyazhou/Downloads/ChatGPT Image 2026年9月7日 01_58_35.png`.

A / B / C are workspace states, not themes. Preserve current BrandLogo and all runtime APIs. Extend existing theme seeds, semantic tokens and workspace styles; reuse existing menu, button, switch, editor and markdown components.

1. Shell: one 44px macOS toolbar, 48px project navigation rail, 220px optional sidebars, chat and flexible editor. At 1200px history can dock; below it becomes a drawer. Files dock at 951px and above. Below 700px chat/editor are tabs, retaining mounted editor state. Use CSS viewport width so Electron zoom follows the same rules.
2. Native home: existing brand, localized greeting, project picker, task focus, prompt examples. Project readiness derives from the actual selected workspace; no invented file totals or framework labels.
3. Intelligence: summarize actual timeline events and actual execution state in a task progress component. Preserve all raw event renderers in a collapsed details section, with final markdown unchanged.
4. Review: move the existing Diff source and viewers into a full-height accessible overlay with a separate scroll region and focus restoration.
5. Controls/settings: unify density, surfaces, focus states, permission explanations, model availability and credential/connection labels. Keep existing settings persistence and provider verification calls.
6. Verification: lint, typecheck, meaningful layout/state tests, build, and actual native UI operation. Capture required states and compare to the reference, recording any states that cannot be reached honestly. No commit or push.
