# AGENTS.md

## Build & Test Commands

```bash
# Install dependencies
bun install

# Type check (acts as lint)
bun run typecheck

# Run CLI development
bun run src/index.ts <command>

# Build for production  
bun run build

# Run with debug output
bun run src/index.ts --debug <command>
```

## Code Style Guidelines

- **Language**: TypeScript with strict mode enabled
- **Runtime**: Bun (>=1.0.0)
- **Import Style**: Use ES6 imports, prefer named exports
- **Types**: Use Zod schemas for runtime validation, TypeScript types for compile-time
- **Naming**: PascalCase for classes, camelCase for variables/functions, UPPER_SNAKE_CASE for constants
- **Error Handling**: Extend custom error classes from `BenchError` base class
- **Logging**: Use the centralized `Logger` class with appropriate log levels
- **File Structure**: Group related functionality in directories (core/, agents/, utils/, etc.)
- **Documentation**: Add JSDoc comments for all public APIs and classes
- **Validation**: Always validate task configurations using Zod schemas before processing