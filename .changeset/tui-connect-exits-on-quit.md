---
"@helmsmith/gittyup": patch
"@helmsmith/gitradar": patch
"@helmsmith/taskmaster": patch
"@helmsmith/mech-pencil": patch
---

`connect` (and mech-pencil's `wizard`) exits when you quit. Pressing `q` used to clear the screen and leave the process running until it was killed, because the shared TUI harness stopped openTUI's render loop instead of destroying the renderer, so the terminal and stdin were never released. The harness now destroys the renderer, and the process exits normally.
