@AGENTS.md

## Claude Code notes

- Use the `/code-review` skill before opening a PR that touches main-process, preload or IPC code.
- For UI changes, run `pnpm dev` and check the real window (title bar, Settings, dialogs) rather than trusting types alone.
- Plan large changes first; this repo's protected `main` means every change is a branch plus a PR with auto-merge.
