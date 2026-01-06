## ADDED Requirements

### Requirement: Project-Level MCP Configuration

The project SHALL provide a `.mcp.json` file at the repository root that configures MCP (Model Context Protocol) servers for Claude Code, enabling consistent AI-assisted development across all team members.

#### Scenario: Developer clones repository and gets MCP servers automatically

- **GIVEN** a developer clones the bloom-desktop repository
- **WHEN** they open Claude Code in the project directory
- **THEN** Claude Code SHALL automatically detect the `.mcp.json` configuration
- **AND** SHALL prompt for approval to use the project-scoped MCP servers on first use
- **AND** SHALL load the playwright MCP server for browser automation
- **AND** SHALL load the serena MCP server for semantic code navigation

#### Scenario: Playwright MCP server provides browser automation

- **GIVEN** the `.mcp.json` configures the playwright MCP server
- **WHEN** Claude Code loads the project configuration
- **THEN** browser automation tools SHALL be available (browser_navigate, browser_click, browser_snapshot, etc.)
- **AND** the server SHALL run via `npx @playwright/mcp@latest`
- **AND** no additional installation SHALL be required

#### Scenario: Serena MCP server provides semantic code navigation

- **GIVEN** the `.mcp.json` configures the serena MCP server
- **WHEN** Claude Code loads the project configuration
- **THEN** semantic code tools SHALL be available (find_symbol, get_symbols_overview, replace_symbol_body, etc.)
- **AND** the server SHALL use the current project directory as its context
- **AND** the server SHALL run via `uvx --from git+https://github.com/oraios/serena`

#### Scenario: MCP configuration uses portable paths

- **GIVEN** the `.mcp.json` file is checked into git
- **WHEN** different developers on different machines use the configuration
- **THEN** the serena MCP server SHALL use relative path "." for project root
- **AND** the configuration SHALL NOT contain machine-specific absolute paths
- **AND** the configuration SHALL work on Linux, macOS, and Windows
