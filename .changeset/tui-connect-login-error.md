---
"@helmsmith/gittyup": patch
"@helmsmith/gitradar": patch
"@helmsmith/taskmaster": patch
"@helmsmith/mech-pencil": patch
"@helmsmith/toolz": patch
"@helmsmith/skillzkit": patch
---

`connect` now shows why a login or logout failed. The error was written into the connection's status line and then immediately replaced when the view re-checked the status, so a failed login looked like nothing happened. It now stays on its own line under the actions until you start another action, and a failed logout no longer shows a still-connected account as disconnected.
