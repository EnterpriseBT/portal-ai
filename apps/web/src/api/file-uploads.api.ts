import type { FileUploadParseResponsePayload } from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

/**
 * The parse endpoint accepts one or more multipart `file` fields. The `body`
 * mapper returns a `FormData` with each `File` appended under the same
 * `file` key — multer's `array("file")` collects them server-side. The
 * browser controls the multipart boundary; `useAuthFetch` forwards FormData
 * payloads without rewriting the Content-Type (see `utils/api.util.ts`).
 */
export const fileUploads = {
  parse: () =>
    useAuthMutation<FileUploadParseResponsePayload, File[]>({
      url: "/api/file-uploads/parse",
      body: (files) => {
        const fd = new FormData();
        for (const file of files) fd.append("file", file);
        return fd;
      },
    }),
};
