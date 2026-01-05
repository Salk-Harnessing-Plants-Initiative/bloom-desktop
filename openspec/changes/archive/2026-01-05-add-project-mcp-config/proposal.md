## Why

Claude Code MCP server configuration is currently stored in individual user's `~/.claude.json` file, which means:

- New developers must manually configure MCP servers (playwright, serena) when cloning the repo
- Configuration can drift between team members
- Developer onboarding requires additional setup steps not documented in the repository

Moving MCP configuration to a project-level `.mcp.json` file makes the development environment self-contained and reproducible.

## What Changes

- Add `.mcp.json` file at project root with playwright and serena MCP server configurations
- Document the MCP configuration in developer workflows spec
- Update CLAUDE.md or project documentation to reference the shared configuration

## Impact

- Affected specs: `developer-workflows`
- Affected code: No code changes - configuration file only
- Files created: `.mcp.json`