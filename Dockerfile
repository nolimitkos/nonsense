FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHON_BIN=python3
ENV PATH="/usr/local/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git cmake ninja-build g++ build-essential \
    ca-certificates curl unzip bash && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Deobfuscator ./Deobfuscator
COPY Engines ./Engines
COPY tools ./tools
COPY package.json bot.js ./

# Build the Linux Luau binaries required by the bundled Luraph V15 engine.
# Keep the two targets separate for maximum CMake compatibility on Railway.
ARG LUAU_VERSION=0.709
RUN git clone --filter=blob:none --depth 1 --branch ${LUAU_VERSION} https://github.com/luau-lang/luau.git /tmp/luau \
    && cmake -S /tmp/luau -B /tmp/luau/cmake -G Ninja \
       -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF -DLUAU_BUILD_CLI=ON \
    && cmake --build /tmp/luau/cmake --target Luau.Repl.CLI --parallel 2 \
    && cmake --build /tmp/luau/cmake --target Luau.Ast.CLI --parallel 2 \
    && mkdir -p Deobfuscator/bin \
    && cp /tmp/luau/cmake/luau Deobfuscator/bin/luau \
    && cp /tmp/luau/cmake/luau-ast Deobfuscator/bin/luau-ast \
    && chmod +x Deobfuscator/bin/luau Deobfuscator/bin/luau-ast \
    && test -x Deobfuscator/bin/luau \
    && test -x Deobfuscator/bin/luau-ast \
    && rm -rf /tmp/luau

RUN npm install --omit=dev

# Third-party engines are installed lazily when their command is first used.
# This prevents a single optional engine/repository failure from making the
# entire Railway Docker build fail.
RUN chmod +x tools/*.sh

CMD ["node", "bot.js"]
