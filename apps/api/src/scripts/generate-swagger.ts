#!/usr/bin/env node
import { writeFileSync } from "fs";
import { swaggerSpec } from "../config/swagger.config.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "swagger-generator" });

/**
 * Generates a static OpenAPI specification file from the Swagger configuration.
 * This is useful for CI/CD pipelines, external documentation tools, or version control.
 */
const generateSwaggerSpec = () => {
  const outputPath = "./swagger.json";

  try {
    writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2));
    logger.info(
      { path: outputPath },
      "OpenAPI specification generated successfully"
    );
    console.log(`✅ OpenAPI spec generated: ${outputPath}`);
  } catch (error) {
    logger.error({ error }, "Failed to generate OpenAPI specification");
    console.error("❌ Failed to generate OpenAPI spec:", error);
    process.exit(1);
  }
};

generateSwaggerSpec();
