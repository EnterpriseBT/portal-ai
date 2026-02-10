FROM node:latest AS dev

# Install git and git autocomplete
RUN apt-get update && apt-get install -y \
    git \
    bash-completion \
    && rm -rf /var/lib/apt/lists/*

# Enable bash completion (git completion is included automatically)
RUN echo 'if [ -f /usr/share/bash-completion/bash_completion ]; then' >> ~/.bashrc && \
    echo '  . /usr/share/bash-completion/bash_completion' >> ~/.bashrc && \
    echo 'fi' >> ~/.bashrc

# Set working directory
WORKDIR /worspace

# Default command
CMD ["node"]
