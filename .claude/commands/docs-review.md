# Documentation Review & Maintenance

Systematic workflow for reviewing and updating bloom-desktop documentation to ensure accuracy and completeness.

## Quick Commands

```bash
# Find all documentation files
find . -name "*.md" -not -path "*/node_modules/*" -not -path "*/.next/*" | sort

# Search for TODO/FIXME in docs
grep -r "TODO\|FIXME\|TBD" --include="*.md" .

# Check for broken internal links
find . -name "*.md" -not -path "*/node_modules/*" -exec grep -H "\[.*\](.*\.md)" {} \;

# View recently modified docs
find . -name "*.md" -not -path "*/node_modules/*" -mtime -7 -exec ls -lh {} \;

# Find undocumented IPC channels
rg "ipcMain\.handle\(" src/main/ -A 2 | grep -o "'[^']*'" | sort -u

# Find undocumented npm scripts
jq '.scripts | keys[]' package.json | sort

# Find undocumented environment variables
rg "process\.env\." --type ts | grep -o "process\.env\.[A-Z_]*" | sort -u
```

## Documentation Inventory

### Existing Documentation ✅

**Core Technical Docs** (`/docs/`):
- ✅ `DATABASE.md` - Prisma schema, IPC API, testing, scanner integration
- ✅ `PACKAGING.md` - Electron packaging, Prisma/ASAR issues, troubleshooting
- ✅ `E2E_TESTING.md` - Playwright E2E tests, CI integration, platform-specific setup
- ✅ `CAMERA_TESTING.md` - Camera interface testing, mock vs real hardware
- ✅ `DAQ_TESTING.md` - DAQ/turntable testing, position tracking
- ✅ `SCANNER_TESTING.md` - Full scan workflow coordination
- ✅ `PACKAGED_APP_TESTING.md` - Production package testing
- ✅ `CONFIGURATION.md` - All configurable settings and defaults
- ✅ `PILOT_COMPATIBILITY.md` - Schema compatibility verification
- ✅ `SCANNER_DATABASE_INTEGRATION_PLAN.md` - Integration design

**Root Documentation**:
- ✅ `README.md` - Project overview, setup, architecture, testing
- ✅ `CLAUDE.md` - OpenSpec integration for AI assistants

**OpenSpec** (`/openspec/`):
- ✅ `AGENTS.md` - AI agent workflow instructions
- ✅ `project.md` - Project conventions and context
- ✅ `specs/` - Current specifications for built capabilities
- ✅ `changes/` - Active proposals and archived changes

**Python Documentation**:
- ✅ `python/PYINSTALLER.md` - PyInstaller build process and troubleshooting

### Missing Documentation ❌

**Critical Gaps**:
- ❌ `CONTRIBUTING.md` - Contribution guidelines, PR process, code review
- ❌ `ARCHITECTURE.md` - System architecture, design patterns, module interactions
- ❌ `SECURITY.md` - Security policy, vulnerability reporting

**Would Be Nice**:
- ⚠️ Complete IPC API reference
- ⚠️ Troubleshooting index (consolidate from all docs)
- ⚠️ Development workflow guide
- ⚠️ Release process documentation
- ⚠️ Python API documentation (beyond PyInstaller)

## Documentation Review Checklist

### Core Documentation

- [ ] **README.md** - Project overview, setup, migration status current?
- [ ] **CONTRIBUTING.md** - Exists? Covers PR process, testing, code style?
- [ ] **ARCHITECTURE.md** - System design documented? Diagrams current?
- [ ] **SECURITY.md** - Security policy defined? Reporting process clear?
- [ ] **CLAUDE.md** - OpenSpec instructions current?

### Technical Guides (`docs/`)

- [ ] **DATABASE.md** - Schema matches `prisma/schema.prisma`?
- [ ] **PACKAGING.md** - Reflects latest Electron Forge config?
- [ ] **E2E_TESTING.md** - Playwright commands work? CI setup matches?
- [ ] **CAMERA_TESTING.md** - Commands work? Mock setup clear?
- [ ] **DAQ_TESTING.md** - Settings table matches types?
- [ ] **SCANNER_TESTING.md** - Workflow accurate? Settings match code?
- [ ] **PACKAGED_APP_TESTING.md** - Instructions tested?
- [ ] **CONFIGURATION.md** - All defaults documented and correct?
- [ ] **PILOT_COMPATIBILITY.md** - Schema comparison current?

### OpenSpec Documentation

- [ ] **openspec/AGENTS.md** - Workflow clear? Examples work?
- [ ] **openspec/project.md** - Context current? Tech stack matches?
- [ ] **openspec/specs/** - Specs match implementation?
- [ ] **Active changes** - Documented properly?

### Python Documentation

- [ ] **python/PYINSTALLER.md** - Build process accurate? Troubleshooting complete?

### Code Documentation

- [ ] TypeScript files have JSDoc comments for public APIs?
- [ ] Python files have docstrings?
- [ ] Complex algorithms explained?
- [ ] IPC channels documented?

## Documentation Maintenance Workflow

### Phase 1: Accuracy Verification

**When to do**: After significant code changes

**Tasks**:
1. Verify all code examples compile and run
2. Check configuration values match actual defaults
3. Test all CLI commands in documentation
4. Verify file paths and directory structures
5. Update screenshots if UI changed

**Files to check**:
- All testing guides (commands must work)
- Configuration documentation (defaults must match code)
- README setup instructions

### Phase 2: Completeness Review

**When to do**: Quarterly or before major releases

**Tasks**:
1. Check for undocumented features (search codebase vs docs)
2. Identify missing API documentation
3. Find gaps in troubleshooting coverage
4. Review error messages in code - are they documented?

**Search patterns**:
```bash
# Find undocumented IPC channels
rg "ipcMain\.handle\(" src/main/ -A 2 | grep -o "'[^']*'" | sort -u

# Find undocumented npm scripts
jq '.scripts | keys[]' package.json | sort

# Check which IPC channels are documented
rg "window\.electron\." docs/ | grep -o "window\.electron\.[a-zA-Z.]*" | sort -u
```

### Phase 3: Consistency Enforcement

**Standards**:
1. **Command format**: Always use `npm run <script>` for package scripts
2. **File paths**: Use relative paths from project root
3. **Code blocks**: Always specify language for syntax highlighting
4. **Headings**: Follow hierarchy (no skipping levels)
5. **Cross-references**: Use relative links: `[text](./FILE.md#section)`

**Checklist**:
- [ ] All bash commands use `bash` syntax highlighting
- [ ] All TypeScript examples use `typescript` or `javascript`
- [ ] All file paths are clear (absolute or relative)
- [ ] All cross-references use relative links
- [ ] All npm scripts referenced match package.json

### Phase 4: Cross-Reference Validation

```bash
# Check for broken internal links
rg '\[.*\]\(\./[^)]+\.md' docs/ | while read line; do
  file=$(echo "$line" | grep -o '\./[^)]*')
  if [ ! -f "docs/$file" ]; then
    echo "Broken link: $line"
  fi
done

# Check npm scripts match documentation
grep "npm run" docs/*.md | grep -o "npm run [a-z:]*" | sort -u > /tmp/docs-scripts.txt
jq -r '.scripts | keys[] | "npm run " + .' package.json | sort > /tmp/package-scripts.txt
diff /tmp/docs-scripts.txt /tmp/package-scripts.txt

# Find undocumented environment variables
rg "process\.env\.[A-Z_]+" --type ts -o | sort -u > /tmp/code-env-vars.txt
rg "BLOOM_[A-Z_]+" docs/ -o | sort -u > /tmp/documented-env-vars.txt
```

## Documentation Standards

### Bloom Desktop Style Guide

1. **Tone**: Technical but clear, assumes developer audience
2. **Examples**: Always use TypeScript/JavaScript, show imports
3. **Commands**: Show full command with directory context
4. **Sections**: Overview → Setup → Usage → API/Reference → Troubleshooting
5. **Code blocks**: Always specify language for syntax highlighting
6. **Links**: Use relative paths for internal docs

### What to Document

✅ **Do Document:**
- Setup and installation steps
- Common workflows and patterns
- API changes and new IPC channels
- Breaking changes
- Configuration options with defaults
- Troubleshooting common errors
- Architecture decisions

❌ **Don't Document:**
- Implementation details (use code comments instead)
- Temporary workarounds (fix the issue instead)
- Obvious code behavior (self-documenting code is better)
- Internal implementation (unless for maintainers)

### Where to Document

| Content Type | Location |
|--------------|----------|
| Project overview | README.md |
| Contribution process | CONTRIBUTING.md |
| System architecture | ARCHITECTURE.md |
| Security policy | SECURITY.md |
| Database/Prisma | docs/DATABASE.md |
| Packaging/Distribution | docs/PACKAGING.md |
| E2E testing | docs/E2E_TESTING.md |
| Hardware testing | docs/CAMERA_TESTING.md, docs/DAQ_TESTING.md, docs/SCANNER_TESTING.md |
| Configuration | docs/CONFIGURATION.md |
| Python packaging | python/PYINSTALLER.md |
| Change proposals | openspec/changes/*/proposal.md |
| Specifications | openspec/specs/*/spec.md |
| AI assistant instructions | CLAUDE.md |

## Common Documentation Issues

### Issue 1: Outdated Setup Instructions

**Symptom**: Setup instructions reference old tools, commands, or versions

**Fix**:
1. Test setup on clean environment (or Docker container)
2. Update step-by-step instructions
3. Update prerequisites and versions
4. Add troubleshooting section for common errors

### Issue 2: Missing New Features

**Symptom**: New features added but not documented

**Fix**:
1. Add feature to relevant docs (`docs/*.md`)
2. Update README if user-facing
3. Add usage examples
4. Update architecture docs if needed
5. Create OpenSpec spec if capability added

### Issue 3: Broken Code Examples

**Symptom**: Code examples don't compile or run

**Fix**:
1. Test each code example
2. Update to current API
3. Add comments explaining key parts
4. Consider extracting to runnable test file

### Issue 4: Dead Links

**Symptom**: Links to moved/deleted files or external resources

**Fix**:
1. Find broken links with grep
2. Update or remove dead links
3. Use relative paths for internal links
4. Archive external content if critical

### Issue 5: Inconsistent Documentation

**Symptom**: Different commands/formats across docs

**Fix**:
1. Standardize on `npm run` for package scripts
2. Use consistent code block syntax highlighting
3. Follow same heading hierarchy
4. Use templates for new documentation

## Periodic Documentation Audits

### Monthly Audit

```bash
# 1. Find outdated docs (not modified in 90 days)
find . -name "*.md" -not -path "*/node_modules/*" -mtime +90

# 2. Check for TODOs in docs
grep -r "TODO\|TBD\|FIXME" --include="*.md" .

# 3. Test README.md quick start
# Follow README step-by-step in fresh environment

# 4. Check for undocumented features
# Compare IPC channels in code vs docs
diff <(rg "ipcMain\.handle\(" src/main/ | grep -o "'[^']*'" | sort) \
     <(rg "window\.electron" docs/ | grep -o "window\.electron\.[^(]*" | sort)
```

### Quarterly Audit

- [ ] Review architecture docs against current codebase
- [ ] Update screenshots and diagrams
- [ ] Review and update technology versions
- [ ] Check if any deprecated features need doc removal
- [ ] Add any new patterns or best practices discovered
- [ ] Run full `/docs-review` command

## Documentation Templates

See the `/docs-review` command for full templates for:
- CONTRIBUTING.md
- ARCHITECTURE.md
- SECURITY.md

## Project-Specific Guidelines

### Migration Context

This project is actively migrating from `bloom-desktop-pilot`. Documentation should:
- Track migration status in README.md
- Maintain pilot compatibility notes
- Document feature parity progress
- Link to pilot repo for reference

### OpenSpec Integration

- All significant changes should have OpenSpec proposals
- Specs should be referenced from technical docs
- Archive process should update documentation
- See `openspec/AGENTS.md` for workflow

### Multi-Platform Considerations

- Document platform-specific setup (Windows/macOS/Linux)
- Note CI differences (Xvfb on Linux, etc.)
- Include platform-specific troubleshooting
- Test commands on all platforms when possible

### Hardware Integration

- Always document mock hardware usage for testing
- Provide both mock and real hardware examples
- Document environment variables for hardware swapping
- Include hardware-specific troubleshooting

## Tips for Effective Documentation

1. **Write as you code** - Don't wait until the end
2. **Test your examples** - Copy-paste and run them
3. **Use consistent formatting** - Follow project style
4. **Add context** - Explain the "why" not just the "what"
5. **Keep it current** - Remove outdated information
6. **Link liberally** - Connect related docs
7. **Use diagrams** - Architecture diagrams in ARCHITECTURE.md
8. **Version breaking changes** - Note when things change
9. **Get feedback** - Ask users if docs are clear
10. **Automate when possible** - Generate API docs from code

## When Documentation is Complete

Documentation is complete when:

- [ ] New user can get started without asking questions
- [ ] All code examples work when copy-pasted
- [ ] Common tasks are documented
- [ ] Breaking changes are noted
- [ ] Links all work
- [ ] No TODO/TBD/FIXME in docs
- [ ] Spelling and grammar are correct
- [ ] Structure is clear and logical
- [ ] All IPC APIs are documented
- [ ] All configuration options are documented

## Documentation Maintenance Schedule

**Weekly**:
- Check recent PRs for documentation updates
- Fix reported documentation bugs

**Monthly**:
- Run quick documentation audit
- Update any outdated screenshots
- Validate external links

**Quarterly**:
- Run full `/docs-review`
- Comprehensive documentation audit
- Review and update all templates
- Check for undocumented features

**Before Releases**:
- Full documentation review
- Test all setup instructions
- Validate all code examples
- Update version-specific notes
- Check migration status

## Related Commands

- `/ci-debug` - CI/CD workflow debugging (references documentation)
- OpenSpec commands - Creating specifications (documented in openspec/AGENTS.md)