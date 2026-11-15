---
"@helmsmith/storybrokr": minor
---

`story` is a short name for `storybrokr`, as `work` is for workbrokr: `npm i -g @helmsmith/storybrokr` now installs both commands, which run the same CLI (`story up`, `story check`, `story --version`). Scripts and hooks keep calling `storybrokr`, the name that cannot collide with another `story` on someone's PATH.
