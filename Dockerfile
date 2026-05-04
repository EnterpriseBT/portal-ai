FROM node:latest AS dev

# Install git, git autocomplete, ngrok CLI, and AWS CLI v2
RUN apt-get update && apt-get install -y \
    git \
    bash-completion \
    curl \
    gnupg \
    unzip \
    postgresql-client \
    && curl -fsSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
    && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | tee /etc/apt/sources.list.d/ngrok.list \
    && apt-get update && apt-get install -y ngrok \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(uname -m) \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscliv2.zip \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/awscliv2.zip /tmp/aws \
    && case "$ARCH" in \
        x86_64) SMP_URL="ubuntu_64bit" ;; \
        aarch64) SMP_URL="ubuntu_arm64" ;; \
        *) echo "Unsupported arch for session-manager-plugin: $ARCH" && exit 1 ;; \
    esac \
    && curl -fsSL "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/${SMP_URL}/session-manager-plugin.deb" -o /tmp/ssm.deb \
    && dpkg -i /tmp/ssm.deb \
    && rm /tmp/ssm.deb

# AWS CLI v2 pages output through `less` by default; `less` isn't installed
# in this image, so disable the pager globally.
ENV AWS_PAGER=""

# Install Docker CLI (for building/pushing images via host Docker socket)
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
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
