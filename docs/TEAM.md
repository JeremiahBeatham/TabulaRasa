# TabulaRasa — Team

## Humans
| Name | Role |
|---|---|
| Jeremiah Beatham | Owner / builder |

## Agent & Branch Ownership
| Surface | Branch | Agent/Session | Status | Notes |
|---|---|---|---|---|
| Plugin core | main | — | maintained | Single-surface project, no parallel agents yet |

## Handoff Notes
None currently — single continuous build.

Stale branches are deleted once their PR merges; `main` is the only long-lived
branch. Releases are cut by dispatching `.github/workflows/release.yml` on `main`
after the version bump lands, which is what BRAT installs from.
