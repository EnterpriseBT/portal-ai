import swaggerJsdoc from "swagger-jsdoc";
import { environment } from "../environment.js";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "MCP UI API Documentation",
      version: "1.0.0",
      description:
        "API documentation for the MCP UI application. This API provides endpoints for health checks and protected resources with Auth0 JWT authentication.",
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
      },
    },
    tags: [
      {
        name: "Health",
        description: "Health check endpoints",
      },
      {
        name: "User",
        description: "User profile and authentication endpoints",
      },
    ],
  },
  apis: ["./src/routes/*.ts", "./src/routes/*.js"], // Path to the API routes
};

export const swaggerSpec = swaggerJsdoc(options);
