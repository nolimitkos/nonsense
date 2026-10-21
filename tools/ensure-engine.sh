#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/Engines/thirdparty"
ENGINE="${1:-}"
mkdir -p "$DEST"

warn() { printf '[engine] WARNING: %s\n' "$*" >&2; }
need_clone() {
  local url="$1" dir="$2"
  if [ -d "$DEST/$dir/.git" ]; then return 0; fi
  rm -rf "$DEST/$dir"
  git clone --depth 1 "$url" "$DEST/$dir"
}
install_lune() {
  command -v lune >/dev/null 2>&1 && return 0
  local ver="${LUNE_VERSION:-0.10.5}" arch asset
  case "$(uname -m)" in
    x86_64|amd64) asset="lune-${ver}-linux-x86_64";;
    aarch64|arm64) asset="lune-${ver}-linux-aarch64";;
    *) warn "Unsupported architecture for Lune: $(uname -m)"; return 1;;
  esac
  local url="https://github.com/lune-org/lune/releases/download/v${ver}/${asset}.zip"
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/lune.zip" || { rm -rf "$tmp"; return 1; }
  unzip -q "$tmp/lune.zip" -d "$tmp/out" || { rm -rf "$tmp"; return 1; }
  local bin; bin="$(find "$tmp/out" -type f -name lune | head -1)"
  [ -n "$bin" ] || { rm -rf "$tmp"; return 1; }
  install -m 0755 "$bin" /usr/local/bin/lune
  rm -rf "$tmp"
  lune --version >/dev/null
}
install_dotnet() {
  command -v dotnet >/dev/null 2>&1 && return 0
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$tmp/dotnet-install.sh" || { rm -rf "$tmp"; return 1; }
  bash "$tmp/dotnet-install.sh" --channel 8.0 --install-dir /usr/share/dotnet >/dev/null || { rm -rf "$tmp"; return 1; }
  ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
  rm -rf "$tmp"
  dotnet --version >/dev/null
}
case "$ENGINE" in
  luraph14|moonveil)
    install_lune
    need_clone https://github.com/binxgtl/luau-vmp-deobf.git luau-vmp-deobf
    python3 -m pip install --break-system-packages -e "$DEST/luau-vmp-deobf"
    ;;
  luaobf-good)
    need_clone https://github.com/axomtools/luaobfuscator-chaoticgood-deobf.git luaobfuscator-chaoticgood-deobf
    ;;
  luraph15v2)
    need_clone https://github.com/Aditya-lua/Deobfuscator-Luraph-V15.git luraph-v15-v2
    (cd "$DEST/luraph-v15-v2" && npm install --omit=dev)
    ;;
  luast)
    need_clone https://github.com/Aditya-lua/Luast.git Luast
    ;;
  flowauth)
    need_clone https://github.com/Aditya-lua/FlowAuth-Deobfuscator.git FlowAuth-Deobfuscator
    need_clone https://github.com/Aditya-lua/Deobfuscator-Luraph-V15.git luraph-v15-v2
    (cd "$DEST/luraph-v15-v2" && npm install --omit=dev)
    ;;
  luarmor)
    need_clone https://github.com/Aditya-lua/Luarmor-Fetch.git Luarmor-Fetch
    need_clone https://github.com/Aditya-lua/Deobfuscator-Luraph-V15.git luraph-v15-v2
    (cd "$DEST/luraph-v15-v2" && npm install --omit=dev)
    ;;
  hidelat)
    need_clone https://github.com/axomtools/hidelat-deobfuscator-byaxom.git hidelat-deobfuscator-byaxom
    ;;
  ironbrew2)
    need_clone https://github.com/axomtools/ironbrew2-deobfuscator.git ironbrew2-deobfuscator
    if [ -f "$DEST/ironbrew2-deobfuscator/requirements.txt" ]; then python3 -m pip install --break-system-packages -r "$DEST/ironbrew2-deobfuscator/requirements.txt"; fi
    ;;
  goofy)
    install_lune
    need_clone https://github.com/JamiesNolandGiggleShi1er/GoofyscatorEnvlogger.git GoofyscatorEnvlogger
    if [ -f "$DEST/GoofyscatorEnvlogger/requirements.txt" ]; then python3 -m pip install --break-system-packages -r "$DEST/GoofyscatorEnvlogger/requirements.txt"; fi
    ;;
  ironveil1)
    need_clone https://github.com/prostone55/Ironveil-Deobfuscator-V1.git Ironveil-Deobfuscator-V1
    if [ -f "$DEST/Ironveil-Deobfuscator-V1/deobfuscator/package.json" ]; then (cd "$DEST/Ironveil-Deobfuscator-V1/deobfuscator" && npm install --omit=dev); fi
    ;;
  77f)
    install_dotnet
    need_clone https://github.com/Bytecoded1337/77fuscatorDeobfuscator.git 77fuscatorDeobfuscator
    if [ -f "$DEST/77fuscatorDeobfuscator/deobfuscator.csproj" ]; then dotnet build "$DEST/77fuscatorDeobfuscator/deobfuscator.csproj" -c Debug; fi
    ;;
  prometheus|wearedevs)
    need_clone https://github.com/prostone4/Prometheus-Deobfuscator.git Prometheus-Deobfuscator
    (cd "$DEST/Prometheus-Deobfuscator" && npm install --omit=dev)
    ;;
  hercules)
    need_clone https://github.com/h7705679/hercules-deobfuscator.git hercules-deobfuscator
    ;;
  luaobf-evil)
    :
    ;;
  *)
    echo "Unknown engine: $ENGINE" >&2
    exit 2
    ;;
esac
printf '[engine] ready: %s\n' "$ENGINE"
