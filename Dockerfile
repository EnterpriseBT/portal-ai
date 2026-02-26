FROM node:latest AS dev

# Install git, git autocomplete, and ngrok CLI
RUN apt-get update && apt-get install -y \
    git \
    bash-completion \
    curl \
    gnupg \
    && curl -fsSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
    && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | tee /etc/apt/sources.list.d/ngrok.list \
    && apt-get update && apt-get install -y ngrok \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.local/bin:${PATH}"

# Enable bash completion (git completion is included automatically)
RUN printf 'if [ -f /usr/share/bash-completion/bash_completion ]; then\n  . /usr/share/bash-completion/bash_completion\nfi\n' >> ~/.bashrc

# Set working directory
WORKDIR /workspace

# Default command
CMD ["node"]
