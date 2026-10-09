# Engineering principles

Consult **before** writing code.

- Solve first, optimize later; readable code over clever code.
- Avoid premature abstractions; propose a simpler alternative before adding complexity.
- Preserve existing behavior; don't refactor outside the task's scope.
- Document decisions, not implementation.
- Generic: nothing of any consumer (MCP, agents, moodle-mcp's tools) in the code or its messages (ADR-006).
- The driver never types, stores or asks for a password; the person logs in by hand (ADR-002).
- Reading first: a write function comes only after the reads it relies on.
- Moodle's HTML is not an API: each area keeps its selectors to itself, prefers ids, data attributes, body ids and URLs over visible texts, and fails with a clear message when the page isn't what it expects.
- Services before pages: an AJAX service when one gives what's needed, pages and forms otherwise (ADR-004).
- The browser profile lives outside any program's folder, and is never committed (ADR-002).
