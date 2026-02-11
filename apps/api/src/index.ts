import { app } from "./app.js";
import { environment } from "./environment.js";
import { logger } from "./utils/logger.util.js";

app.listen(environment.PORT, () => {
  logger.info(
    {
      port: environment.PORT,
      env: environment.NODE_ENV,
    },
    "API server started"
  );
});
