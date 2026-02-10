FROM node:latest AS dev

# Install git and git autocomplete
RUN apt-get update && apt-get install -y \
    git \
    bash-completion \
    && rm -rf /var/lib/apt/lists/*

# Enable git bash completion
RUN echo 'source /etc/bash_completion.d/git' >> ~/.bashrc

# Set working directory
WORKDIR /worspace

# Default command
CMD ["node"]
