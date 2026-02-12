import swaggerJsdoc from "swagger-jsdoc";

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
        UserProfileResponse: {
          type: "object",
          required: ["status", "data"],
          properties: {
            status: {
              type: "string",
              enum: ["OK"],
              description: "Response status",
            },
            data: {
              type: "object",
              properties: {
                sub: {
                  type: "string",
                  description: "User ID from Auth0",
                },
                scope: {
                  type: "string",
                  description: "OAuth scopes granted to the user",
                },
                permissions: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                  description: "Permissions assigned to the user",
                },
              },
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
