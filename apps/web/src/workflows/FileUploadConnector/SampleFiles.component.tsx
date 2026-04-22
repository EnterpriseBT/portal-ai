import React from "react";

import Link from "@mui/material/Link";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";

import { Stack, Typography } from "@portalai/core/ui";

// --- Sample File Registry ---

interface SampleFile {
  label: string;
  description: string;
  href: string;
  downloadName: string;
  icon: React.ReactNode;
}

const SAMPLE_FILES: SampleFile[] = [
  {
    label: "region-segmentation-matrix.csv",
    description:
      "Every region-config permutation (orientation × headerAxis × role pattern) in one CSV",
    href: "/samples/region-segmentation-matrix.csv",
    downloadName: "region-segmentation-matrix.csv",
    icon: <DescriptionOutlinedIcon fontSize="small" color="action" />,
  },
  {
    label: "region-segmentation-matrix.xlsx",
    description:
      "Same permutation matrix, one permutation per sheet — easier to draw against",
    href: "/samples/region-segmentation-matrix.xlsx",
    downloadName: "region-segmentation-matrix.xlsx",
    icon: <TableChartOutlinedIcon fontSize="small" color="action" />,
  },
];

// --- Component ---

export const SampleFiles: React.FC = () => {
  return (
    <Stack
      spacing={0.5}
      aria-label="Sample files illustrating the recommended upload format"
    >
      <Typography variant="caption" color="text.secondary">
        Need a template? Download a sample illustrating the recommended layout:
      </Typography>
      <Stack
        direction="row"
        spacing={2}
        flexWrap="wrap"
        useFlexGap
        sx={{ rowGap: 0.5 }}
      >
        {SAMPLE_FILES.map((file) => (
          <Stack
            key={file.label}
            direction="row"
            spacing={0.75}
            alignItems="center"
          >
            {file.icon}
            <Link
              href={file.href}
              download={file.downloadName}
              variant="body2"
              underline="hover"
            >
              {file.label}
            </Link>
            <Typography variant="caption" color="text.secondary">
              — {file.description}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
};
