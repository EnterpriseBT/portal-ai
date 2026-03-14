import swaggerJsdoc from "swagger-jsdoc";
import { environment } from "../environment.js";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Portal.ai API Documentation",
      version: "1.0.0",
      description:
        "API documentation for the Portal.ai application. This API provides endpoints for health checks and protected resources with Auth0 JWT authentication.",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your Auth0 JWT token",
        },
        oauth2: {
          type: "oauth2",
          flows: {
            implicit: {
              authorizationUrl: `https://${environment.AUTH0_DOMAIN}/authorize?audience=${environment.AUTH0_AUDIENCE}`,
              scopes: {
                openid: "OpenID Connect",
                profile: "User profile",
                email: "User email",
              },
            },
          },
          description: "OAuth2 authentication with Auth0",
        },
      },
      parameters: {
        limitParam: {
          in: "query",
          name: "limit",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
          },
          description: "Number of items per page",
        },
        offsetParam: {
          in: "query",
          name: "offset",
          schema: {
            type: "integer",
            minimum: 0,
            default: 0,
          },
          description: "Number of items to skip",
        },
        sortByParam: {
          in: "query",
          name: "sortBy",
          schema: {
            type: "string",
            default: "created",
          },
          description: "Field to sort by",
        },
        sortOrderParam: {
          in: "query",
          name: "sortOrder",
          schema: {
            type: "string",
            enum: ["asc", "desc"],
            default: "asc",
          },
          description: "Sort direction",
        },
      },
      schemas: {
        ApiErrorResponse: {
          type: "object",
          required: ["status", "message", "code"],
          properties: {
            status: {
              type: "string",
              enum: ["ERROR"],
              description: "Response status",
            },
            message: {
              type: "string",
              description: "Error message",
            },
            code: {
              type: "string",
              description: "Error code",
            },
          },
        },
        HealthResponse: {
          type: "object",
          required: ["status", "timestamp"],
          properties: {
            status: {
              type: "string",
              enum: ["OK"],
              description: "Response status",
            },
            timestamp: {
              type: "string",
              format: "date-time",
              example: "2024-01-01T00:00:00.000Z",
              description: "Current server timestamp",
            },
          },
        },
        UserProfile: {
          type: "object",
          required: ["sub"],
          properties: {
            sub: {
              type: "string",
              description: "User ID (subject)",
              example: "auth0|507f1f77bcf86cd799439011",
            },
            name: {
              type: "string",
              description: "Full name",
              example: "John Doe",
            },
            given_name: {
              type: "string",
              description: "Given name (first name)",
              example: "John",
            },
            family_name: {
              type: "string",
              description: "Family name (last name)",
              example: "Doe",
            },
            middle_name: {
              type: "string",
              description: "Middle name",
            },
            nickname: {
              type: "string",
              description: "Nickname",
              example: "johnny",
            },
            preferred_username: {
              type: "string",
              description: "Preferred username",
            },
            profile: {
              type: "string",
              description: "Profile page URL",
            },
            picture: {
              type: "string",
              description: "Profile picture URL",
              example: "https://example.com/avatar.jpg",
            },
            website: {
              type: "string",
              description: "Website URL",
            },
            email: {
              type: "string",
              format: "email",
              description: "Email address",
              example: "john.doe@example.com",
            },
            email_verified: {
              type: "boolean",
              description: "Whether email is verified",
              example: true,
            },
            gender: {
              type: "string",
              description: "Gender",
            },
            birthdate: {
              type: "string",
              description: "Birthdate",
              example: "1990-01-01",
            },
            zoneinfo: {
              type: "string",
              description: "Time zone",
              example: "America/New_York",
            },
            locale: {
              type: "string",
              description: "Locale",
              example: "en-US",
            },
            phone_number: {
              type: "string",
              description: "Phone number",
              example: "+1 234 567 8900",
            },
            phone_number_verified: {
              type: "boolean",
              description: "Whether phone number is verified",
            },
            address: {
              type: "object",
              description: "Address information",
              properties: {
                formatted: {
                  type: "string",
                  description: "Full formatted address",
                },
                street_address: {
                  type: "string",
                  description: "Street address",
                },
                locality: {
                  type: "string",
                  description: "City/locality",
                },
                region: {
                  type: "string",
                  description: "State/region",
                },
                postal_code: {
                  type: "string",
                  description: "Postal code",
                },
                country: {
                  type: "string",
                  description: "Country",
                },
              },
            },
            updated_at: {
              type: "string",
              description: "Last updated timestamp",
              example: "2024-01-01T00:00:00.000Z",
            },
          },
        },
        ConnectorDefinition: {
          type: "object",
          required: [
            "id",
            "slug",
            "display",
            "category",
            "authType",
            "capabilityFlags",
            "isActive",
            "version",
            "created",
            "createdBy",
          ],
          properties: {
            id: {
              type: "string",
              description: "Unique identifier",
              example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            },
            slug: {
              type: "string",
              description: "URL-friendly unique slug",
              example: "postgresql-connector",
            },
            display: {
              type: "string",
              description: "Human-readable display name",
              example: "PostgreSQL Connector",
            },
            category: {
              type: "string",
              description: "Connector category",
              example: "database",
            },
            authType: {
              type: "string",
              description: "Authentication type required by the connector",
              example: "oauth2",
            },
            configSchema: {
              type: "object",
              nullable: true,
              description: "JSON schema for connector configuration",
              additionalProperties: true,
            },
            capabilityFlags: {
              type: "object",
              description: "Supported capabilities",
              properties: {
                sync: { type: "boolean" },
                query: { type: "boolean" },
                write: { type: "boolean" },
              },
            },
            isActive: {
              type: "boolean",
              description: "Whether the connector definition is active",
              example: true,
            },
            version: {
              type: "string",
              description: "Semantic version of the connector definition",
              example: "1.0.0",
            },
            iconUrl: {
              type: "string",
              nullable: true,
              description: "URL to the connector icon",
              example: "https://example.com/icons/postgres.svg",
            },
            created: {
              type: "number",
              description: "Creation timestamp (epoch ms)",
              example: 1700000000000,
            },
            createdBy: {
              type: "string",
              description: "ID of the creator",
              example: "SYSTEM",
            },
            updated: {
              type: "number",
              nullable: true,
              description: "Last update timestamp (epoch ms)",
            },
            updatedBy: {
              type: "string",
              nullable: true,
              description: "ID of the last updater",
            },
            deleted: {
              type: "number",
              nullable: true,
              description: "Soft-delete timestamp (epoch ms)",
            },
            deletedBy: {
              type: "string",
              nullable: true,
              description: "ID of the deleter",
            },
          },
        },
        PaginatedResponse: {
          type: "object",
          required: ["total", "limit", "offset"],
          properties: {
            total: {
              type: "integer",
              description: "Total number of matching records",
              example: 42,
            },
            limit: {
              type: "integer",
              description: "Page size used for this request",
              example: 20,
            },
            offset: {
              type: "integer",
              description: "Offset used for this request",
              example: 0,
            },
          },
        },
        ConnectorDefinitionListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["connectorDefinitions"],
              properties: {
                connectorDefinitions: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/ConnectorDefinition",
                  },
                },
              },
            },
          ],
        },
        ConnectorDefinitionGetResponse: {
          type: "object",
          required: ["connectorDefinition"],
          properties: {
            connectorDefinition: {
              $ref: "#/components/schemas/ConnectorDefinition",
            },
          },
        },
        Job: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "type",
            "status",
            "progress",
            "metadata",
            "attempts",
            "maxAttempts",
            "created",
            "createdBy",
          ],
          properties: {
            id: {
              type: "string",
              description: "Unique identifier",
              example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            },
            organizationId: {
              type: "string",
              description: "Organization that owns this job",
            },
            type: {
              type: "string",
              enum: ["file_upload"],
              description: "Job type",
            },
            status: {
              type: "string",
              enum: [
                "pending",
                "active",
                "completed",
                "failed",
                "stalled",
                "cancelled",
              ],
              description: "Current job status",
            },
            progress: {
              type: "integer",
              description: "Progress percentage (0-100)",
              example: 0,
            },
            metadata: {
              type: "object",
              additionalProperties: true,
              description: "Arbitrary metadata attached to the job",
            },
            result: {
              type: "object",
              nullable: true,
              additionalProperties: true,
              description: "Job result payload (set on completion)",
            },
            error: {
              type: "string",
              nullable: true,
              description: "Error message (set on failure)",
            },
            startedAt: {
              type: "number",
              nullable: true,
              description: "Start timestamp (epoch ms)",
            },
            completedAt: {
              type: "number",
              nullable: true,
              description: "Completion timestamp (epoch ms)",
            },
            bullJobId: {
              type: "string",
              nullable: true,
              description: "BullMQ job ID",
            },
            attempts: {
              type: "integer",
              description: "Number of attempts made",
              example: 0,
            },
            maxAttempts: {
              type: "integer",
              description: "Maximum number of retry attempts",
              example: 3,
            },
            created: {
              type: "number",
              description: "Creation timestamp (epoch ms)",
              example: 1700000000000,
            },
            createdBy: {
              type: "string",
              description: "ID of the creator",
            },
            updated: {
              type: "number",
              nullable: true,
              description: "Last update timestamp (epoch ms)",
            },
            updatedBy: {
              type: "string",
              nullable: true,
              description: "ID of the last updater",
            },
            deleted: {
              type: "number",
              nullable: true,
              description: "Soft-delete timestamp (epoch ms)",
            },
            deletedBy: {
              type: "string",
              nullable: true,
              description: "ID of the deleter",
            },
          },
        },
        JobListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["jobs"],
              properties: {
                jobs: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Job",
                  },
                },
              },
            },
          ],
        },
        JobGetResponse: {
          type: "object",
          required: ["job"],
          properties: {
            job: {
              $ref: "#/components/schemas/Job",
            },
          },
        },
      },
    },
    tags: [
      {
        name: "Health",
        description: "Health check endpoints",
      },
      {
        name: "Profile",
        description: "User profile and authentication endpoints",
      },
      {
        name: "Connector Definitions",
        description: "Connector definition management endpoints",
      },
      {
        name: "Jobs",
        description: "Background job management endpoints",
      },
    ],
  },
  apis: ["./src/routes/*.ts", "./src/routes/*.js"], // Path to the API routes
};

export const swaggerSpec = swaggerJsdoc(options);
