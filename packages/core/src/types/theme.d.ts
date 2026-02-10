import "@mui/material/styles";

declare module "@mui/material/styles" {
  interface TypographyVariants {
    monospace: React.CSSProperties;
  }

  // Allow configuration using `createTheme`
  interface TypographyVariantsOptions {
    monospace?: React.CSSProperties;
  }
}

// Update the Typography's variant prop options
declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    monospace: true;
  }
}

export {};
