import { ResetService } from "../services/reset.service.js";

const organizationId = process.argv[2];

async function main() {
  if (organizationId) {
    console.log(`Resetting organization: ${organizationId}`);
    await ResetService.resetOrganization(organizationId);
  } else {
    console.log("No organization ID provided — resetting first organization found");
    await ResetService.resetFirst();
  }
}

main()
  .then(() => {
    console.log("Reset completed successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error during reset:", error);
    process.exit(1);
  });
