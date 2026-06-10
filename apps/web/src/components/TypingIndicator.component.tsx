import React from "react";

import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";

interface TypingIndicatorUIProps {
  ariaLabel?: string;
}

const blink = keyframes`
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
`;

/**
 * Animated three-dot indicator shown in the portal chat between when
 * the user sends a message and the assistant's first streamed block
 * arrives. Matches the assistant message-bubble padding/border-radius
 * so it reads as "the assistant is typing".
 */
export const TypingIndicator: React.FC<TypingIndicatorUIProps> = ({
  ariaLabel = "Assistant is typing",
}) => (
  <Box
    role="status"
    aria-label={ariaLabel}
    data-testid="typing-indicator"
    sx={{
      p: 1,
      mb: 1,
      borderRadius: 1,
      display: "flex",
      alignItems: "center",
      gap: 0.75,
    }}
  >
    {[0, 1, 2].map((i) => (
      <Box
        key={i}
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bgcolor: "text.secondary",
          animation: `${blink} 1.2s infinite ease-in-out`,
          animationDelay: `${i * 0.2}s`,
        }}
      />
    ))}
  </Box>
);
