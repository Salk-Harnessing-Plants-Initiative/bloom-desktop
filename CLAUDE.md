<!-- OPENSPEC:START -->

# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:

- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:

- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# MCP Server Configuration

This project includes a `.mcp.json` file that configures Model Context Protocol (MCP) servers for Claude Code. These servers provide additional AI capabilities:

- **playwright**: Browser automation for E2E testing workflows
- **serena**: Semantic code navigation and refactoring tools

When you open this project in Claude Code, these MCP servers are automatically available. No additional setup is required.
