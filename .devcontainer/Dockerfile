FROM node:24-bookworm

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    zsh \
    git \
    curl \
    ca-certificates \
    openssl \
    postgresql-client \
    procps \
    nano \
    less \
    jq \
    ripgrep \
    fzf \
    zsh-autosuggestions \
    zsh-syntax-highlighting \
    sudo \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

RUN mkdir -p \
    /home/node/.local/share/pnpm/store \
    /home/node/.cache/zsh \
    /workspace/node_modules \
    && chown -R node:node /home/node /workspace

RUN echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

RUN chsh -s /usr/bin/zsh node

COPY .devcontainer/.zshrc /home/node/.zshrc

RUN chown node:node /home/node/.zshrc

WORKDIR /workspace

USER node

ENV SHELL=/usr/bin/zsh
ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"