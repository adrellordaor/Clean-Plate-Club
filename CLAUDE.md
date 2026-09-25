# Clean Plate Club: standing rules for Claude Code

## 1. The spec is read-only
Never write to or edit `task-tracker-spec.md`, not even to keep it in sync with code.
That includes restoring it, reverting it, or checking out an older version with git. Only
read it. Spec changes happen exclusively in a separate claude.ai chat and get handed down
from there. If the code and the spec disagree, list the out-of-date passages in chat and
leave the file alone.

## 2. One commit per discrete change
Commit after each discrete change or fix, not in one giant commit at the end of a batch.
When given a numbered list of items, treat each item as its own commit.

## 3. Never push automatically
Commit locally and stop. Only push to GitHub when explicitly told to (e.g. "push it",
"push this").

## 4. Explain things in plain language
The owner has no coding or technical background. When reporting back or explaining
anything (errors, what changed, next steps), use plain language. Don't assume familiarity
with git or developer terms: if one is needed, add a quick explanation alongside it.

## 5. Visual/design work: look before calling it done
For any visual or design work, take screenshots and self-critique against the given brief
before considering a section done, rather than moving on right after writing the code.

## 6. Motion is plain CSS
All motion/animation work defaults to plain CSS: transitions, transforms, keyframes. No
animation library. If something genuinely can't be done cleanly in CSS, treat that as a
deliberate exception and flag it directly in chat first, never quietly pull in GSAP or
similar.

## 7. No snap transitions
Every view, filter, or screen change animates; nothing cuts over instantly. Exception:
persistent/shared chrome (e.g. the Daily Plate/Fridge window frames themselves) stays static
while only the content inside animates out and in. Don't animate the frame itself away and
back for a content-only change.

## 8. Reciprocal animations
Any entrance animation needs a matching exit in reverse; don't build one-directional motion.
E.g. Focus mode's scope-in entry needs a scope-out exit, not a plain fade or an instant close.
