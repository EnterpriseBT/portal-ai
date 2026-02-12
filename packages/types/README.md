# @mcp-ui/types

Shared TypeScript types for the MCP UI project.

## Overview

This package contains all TypeScript type definitions that are shared between the `api` and `web` applications in the MCP UI monorepo.

## Installation

This package is part of the MCP UI monorepo and is consumed internally by other packages:

```json
{
  "dependencies": {
    "@mcp-ui/types": "*"
  }
}
```

## Usage

Import types from the package:

```typescript
import { Auth0UserProfile, ApiSuccessResponse, UserProfile } from '@mcp-ui/types';
```

## Exported Types

### Authentication Types

- `Auth0UserProfile` - Auth0 user profile from the userinfo endpoint
- `UserProfile` - Standard user profile used throughout the application

### API Types

- `ApiResponseStatus` - Enum for API response status (OK, ERROR)
- `ApiResponse` - Base API response interface
- `ApiSuccessResponse` - Successful API response
- `ApiErrorResponse` - Error API response
- `ApiGetHealthResponse` - Health check endpoint response
- `ApiGetProfileResponse` - User profile endpoint response

## Development

Build the package:

```bash
npm run build
```

Type check:

```bash
npm run type-check
```

Lint:

```bash
npm run lint
```

Format:

```bash
npm run format
```
