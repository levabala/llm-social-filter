# Agent Guidelines for llm-social-filter

## Build/Lint/Test Commands
- **Type check**: `bun run tsc` (TypeScript compilation check)
- **Run project**: `bun src/index.ts` (entry point)
- **No specific test runner configured** - check with user for test commands

## Code Style & Conventions
- **Formatting**: Prettier with 4-space tabs, single quotes, 80 char width
- **Imports**: Named imports preferred, group by external/internal
- **Types**: Strict TypeScript with arktype for runtime validation
- **Error handling**: Early returns with error logging to console
- **Database**: JSONFilePreset from lowdb for persistence
- **Environment**: Use `process.env.VAR!` pattern with validation

## Architecture Patterns
- **Modules**: Separate concerns (llm.ts, telegram.ts, twitter.ts, ws.ts)
- **API calls**: Type-safe wrappers with caching and validation
- **State management**: Global refs for handlers, DB for persistence
- **Async**: Liberal use of async/await, Promise.all for parallel ops

## Naming Conventions
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE for globals, camelCase for locals
- **Functions**: camelCase, descriptive names
- **Types**: PascalCase with descriptive suffixes (e.g., TweetType, Intent)

## Git Commit Guidelines
- **Before committing**: Always check the last 5 commit messages with `git log --oneline -5` to match the project's commit message style and format