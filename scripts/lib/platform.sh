#!/usr/bin/env bash
# Cross-platform helpers for cursor-realtime-voice install scripts.
# Source from other scripts:  source "$(dirname "$0")/lib/platform.sh"

platform_detect() {
  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  case "${uname_s}" in
    Darwin)
      PLATFORM_ID="darwin"
      PLATFORM_NAME="macOS"
      ;;
    Linux)
      PLATFORM_ID="linux"
      PLATFORM_NAME="Linux"
      ;;
    MINGW* | MSYS* | CYGWIN*)
      PLATFORM_ID="windows"
      PLATFORM_NAME="Windows"
      ;;
    *)
      PLATFORM_ID="unknown"
      PLATFORM_NAME="${uname_s}"
      ;;
  esac
}

platform_cursor_extensions_dir() {
  if [[ "${PLATFORM_ID}" == "windows" && -n "${USERPROFILE:-}" ]]; then
    echo "${USERPROFILE}/.cursor/extensions"
  else
    echo "${HOME}/.cursor/extensions"
  fi
}

platform_find_cursor_cli() {
  if command -v cursor >/dev/null 2>&1; then
    command -v cursor
    return 0
  fi
  case "${PLATFORM_ID}" in
    darwin)
      local mac_cli="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
      if [[ -x "${mac_cli}" ]]; then
        echo "${mac_cli}"
        return 0
      fi
      ;;
    linux)
      local candidates=(
        "${HOME}/.local/bin/cursor"
        "/usr/local/bin/cursor"
        "/usr/bin/cursor"
        "/opt/Cursor/cursor"
        "${HOME}/.local/share/cursor/bin/cursor"
      )
      local c
      for c in "${candidates[@]}"; do
        if [[ -x "${c}" ]]; then
          echo "${c}"
          return 0
        fi
      done
      ;;
    windows)
      local win_candidates=(
        "${LOCALAPPDATA}/Programs/cursor/resources/app/bin/cursor.cmd"
        "${LOCALAPPDATA}/Programs/Cursor/resources/app/bin/cursor.cmd"
        "${PROGRAMFILES}/Cursor/resources/app/bin/cursor.cmd"
      )
      local w
      for w in "${win_candidates[@]}"; do
        if [[ -f "${w}" ]]; then
          echo "${w}"
          return 0
        fi
      done
      ;;
  esac
  return 1
}

platform_kill_port() {
  local port="$1"
  case "${PLATFORM_ID}" in
    windows)
      if command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
        netstat -ano 2>/dev/null | grep -E ":${port}[[:space:]]" | grep LISTENING | awk '{print $5}' | sort -u | while read -r pid; do
          [[ -n "${pid}" && "${pid}" != "0" ]] && taskkill //F //PID "${pid}" >/dev/null 2>&1 || true
        done
      fi
      ;;
    *)
      if command -v lsof >/dev/null 2>&1; then
        lsof -ti:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
      elif command -v fuser >/dev/null 2>&1; then
        fuser -k "${port}/tcp" 2>/dev/null || true
      fi
      ;;
  esac
}

platform_open_url() {
  local url="$1"
  case "${PLATFORM_ID}" in
    darwin)
      open "${url}" 2>/dev/null || true
      ;;
    linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "${url}" >/dev/null 2>&1 || true
      elif command -v sensible-browser >/dev/null 2>&1; then
        sensible-browser "${url}" >/dev/null 2>&1 || true
      fi
      ;;
    windows)
      if command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c start "" "${url}" >/dev/null 2>&1 || true
      elif command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -Command "Start-Process '${url}'" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

platform_palette_key() {
  if [[ "${PLATFORM_ID}" == "darwin" ]]; then
    echo "Cmd"
  else
    echo "Ctrl"
  fi
}

platform_find_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    command -v python
    return 0
  fi
  return 1
}

platform_post_install_notes() {
  local palette
  palette="$(platform_palette_key)"
  echo "  1. In Cursor: ${palette}+Shift+P → Cursor Voice: Restart Bridge (first install or if voice says bridge unreachable)."
  case "${PLATFORM_ID}" in
    darwin)
      echo "  2. macOS: System Settings → Privacy & Security → Accessibility → enable Cursor (if Agent send fails)."
      ;;
    linux)
      echo "  2. Linux: ensure Cursor desktop bridge is on, or install the extension from the packaged VSIX."
      ;;
    windows)
      echo "  2. Windows: install the VSIX from setup if CLI install failed; enable desktop bridge when available."
      ;;
  esac
  echo "  3. Keep an Agent chat open."
  echo "  4. In the browser: save OpenAI key if needed → tap the voice button."
}
