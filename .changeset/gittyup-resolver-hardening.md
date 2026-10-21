---
"@helmsmith/gittyup": patch
---

Harden conflict resolution (round-2 review, on top of the whole-file-resolution slice):

- A conflict resolution is never read or written through a symlink. A side that replaced the file with a symlink no longer makes `getConflictedFiles` read a file from outside the repo into the AI prompt, and `applyResolution` refuses a symlinked or out-of-repo destination instead of overwriting whatever it points at.
- The resolution gate catches conflict markers of any size (a non-default `conflict-marker-size`), and no longer refuses a legitimate line of exactly seven `=` such as a Setext/RST heading underline.
- Keeping one side of a submodule (gitlink) conflict preserves the submodule instead of deleting it: deletion is decided from `git ls-files -u`, not from whether `git show` could print the stage.
