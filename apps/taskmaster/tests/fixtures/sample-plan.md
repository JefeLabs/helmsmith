# Authentication System

Build a comprehensive authentication system supporting multiple auth providers.

- OAuth 2.0 with Google and GitHub
- JWT token management
- Session handling with Redis

## User Registration

Implement user registration flow with email verification.

Users should be able to register with email/password or via OAuth providers. Send a verification email after registration.

### Email Verification

Build the email verification pipeline:

1. Generate a unique token
2. Send verification email via SendGrid
3. Handle token expiration (24h)

```typescript
interface VerificationToken {
  userId: string;
  token: string;
  expiresAt: Date;
}
```

## Login Flow

Implement secure login with rate limiting and brute force protection.

- Support email/password login
- Support OAuth login (Google, GitHub)
- Implement rate limiting (5 attempts per 15 minutes)

# API Layer

Design and implement the RESTful API layer.

All endpoints follow REST conventions with proper error handling and validation.

## Resource Endpoints

Create CRUD endpoints for the core resources.

- GET /api/users
- POST /api/users
- PUT /api/users/:id
- DELETE /api/users/:id

## Middleware Stack

Build the middleware pipeline for request processing.

- Authentication middleware (JWT verification)
- Rate limiting middleware
- Request validation middleware (Zod schemas)
- Error handling middleware

### Request Validation

Implement Zod-based request validation for all endpoints.

Each endpoint should have a schema for params, query, and body.

# Database Layer

Set up the database with migrations and seed data.

## Schema Design

Design the database schema with proper normalization.

- Users table with profile fields
- Sessions table for session management
- Audit log table for tracking changes

## Migration System

Implement database migrations using Knex.js.

- Create migration files for each schema change
- Support rollback functionality
- Seed data for development environment
