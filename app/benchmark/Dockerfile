FROM mcr.microsoft.com/playwright:v1.56.1-noble
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY package*.json ./
RUN npm ci
COPY runner.mjs tcp.mjs ./
CMD ["sleep","infinity"]
