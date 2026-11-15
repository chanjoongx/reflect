---
description: Ask reflect now why the developer keeps pushing back in this session
allowed-tools: Bash(node *reflect-hook.mjs* manual --agent --plugin --session *)
---

## What reflect found

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/reflect-hook.mjs" manual --agent --plugin --session "${CLAUDE_SESSION_ID}"`

## What to do with it

The developer ran `/brain-reflect` because they want you to step back and look at how this session is going.

If the output above contains a reflect note (it has a Pattern line), it is the note reflect already showed the developer and you, written by a separate model that read the developer's recent messages and what you did just before each one. Tell the developer, in two or three sentences, what it says the pattern is and what you would change. Treat it as a suggestion: the developer's own words decide.

If the output says no outside reflection is available, write one yourself from this conversation. The turns reflect lists as pushback, with the words it quoted, are a good place to start. Look at the developer's last several messages and what you did right before each one. Then tell the developer:

1. **Pattern**: what you have been doing that the developer keeps redirecting, in one sentence. Name the actual behaviour (for example "editing files beyond the one you named"), not a general trait.
2. **Signal**: the developer's words that show it, quoted briefly.
3. **Adjustment**: the concrete change you will make for the next few turns.
4. **Could be wrong if**: one sentence on the most likely other reading.

If nothing in the recent turns looks like pushback, say so plainly and do not invent a pattern.

Keep the whole answer short. Do not start any new work in this reply.
