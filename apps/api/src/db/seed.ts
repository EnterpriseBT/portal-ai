import { SeedService } from "../services/seed.service.js";

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
    console.error("Error during seeding:", error);
    process.exit(1);
  });
