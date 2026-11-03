import { SeedService } from "../services/seed.service.js";
import { createLogger, errorSummary } from "../utils/logger.util.js";

const logger = createLogger({ module: "db-seed" });
const seedService = new SeedService();

async function main() {
  await seedService.seed();
}

main()
  .then(() => {
    console.log("Seeding completed successfully.");
    process.exit(0);
  })
  .catch((error) => {
    // Through the logger, not console: a DrizzleQueryError's message and
    // enumerable fields carry SQL and bound values (#540, #948).
    logger.error(
      { err: error },
      `Error during seeding: ${errorSummary(error)}`
    );
    process.exit(1);
  });
