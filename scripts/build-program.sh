#!/usr/bin/env bash
# Build the on-chain program on Windows without admin rights or Visual Studio.
# Toolchain (installed under the user profile):
#   Rust (GNU host)   ~/.cargo, ~/.rustup
#   MinGW (dlltool)   ~/.local/share/mingw/mingw64/bin
#   Solana/Agave CLI  ~/.local/share/solana/solana-release/bin  (cargo-build-sbf, solana, solana-keygen)
#   Windows libs      ~/.local/share/xwin  (MSVC CRT + SDK via xwin, for host build scripts)
# Output: anchor/target/deploy/firepad.so
# Devnet build (Raydium devnet addresses): npm run build:program -- --features devnet
# Mainnet build (default): npm run build:program
set -euo pipefail
X='C:\Users\user\.local\share\xwin'
export PATH="$HOME/.local/share/mingw/mingw64/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/solana-release/bin:$PATH"
export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER="$HOME/.cache/solana/v1.57/platform-tools/llvm/bin/lld-link.exe"
export LIB="$X\crt\lib\x86_64;$X\sdk\lib\um\x86_64;$X\sdk\lib\ucrt\x86_64"
cd "$(dirname "$0")/../anchor/programs/firepad"
cargo-build-sbf "$@"
