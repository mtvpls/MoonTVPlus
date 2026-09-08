#!/bin/sh
# ============================================================
# 支持通过 PUID / PGID 环境变量指定容器运行时的 UID / GID。
# 默认值 1001 / 1001，与镜像内预创建的 nextjs 用户保持一致。
# 容器以 root 启动，脚本调整用户/组并修正数据目录属主后，
# 通过 su-exec 降权为指定用户运行实际命令。
# 若镜像被以非 root 用户启动（如 OpenShift 随机 UID），
# 则跳过调整直接执行。
# ============================================================
set -e

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"

# 仅当目录属主与目标不一致时才递归修正，避免每次启动全量遍历。
# 顶层目录属主匹配即视为无需处理（挂载卷通常整体属主一致）。
fix_owner() {
  dir="$1"
  [ -d "$dir" ] || return 0
  cur="$(stat -c '%u:%g' "$dir" 2>/dev/null)" || return 0
  if [ "$cur" != "${PUID}:${PGID}" ]; then
    chown -R "${run_user}:${group_name}" "$dir" 2>/dev/null || true
  fi
}

if [ "$(id -u)" = "0" ]; then
  echo "docker-entrypoint: adjusting UID=${PUID} GID=${PGID}"

  # 调整 group 与 user 到目标 UID/GID。
  # 关键原则：
  #  - 目标 GID/UID 若已被系统占用（如 node 镜像的 node 用户），复用现有组/用户，
  #    绝不删除系统自带用户；仅当目标 ID 空闲时才新建。
  #  - 项目自带同名用户/组（nextjs/nodejs，构建于 1001）若已存在，直接改到目标 ID。

  # --- 组 ---
  if ! getent group nodejs >/dev/null; then
    # 组不存在：目标 GID 空闲则新建，被占用则复用现有组
    if getent group "${PGID}" >/dev/null 2>&1; then
      group_name="$(getent group "${PGID}" | cut -d: -f1)"
    else
      addgroup -g "${PGID}" -S nodejs
      group_name="nodejs"
    fi
  else
    # nodejs 组已存在（镜像构建时创建于 1001）：直接改到目标 GID
    delgroup nodejs 2>/dev/null || true
    if getent group "${PGID}" >/dev/null 2>&1; then
      group_name="$(getent group "${PGID}" | cut -d: -f1)"
    else
      addgroup -g "${PGID}" -S nodejs
      group_name="nodejs"
    fi
  fi

  # --- 用户 ---
  if ! getent passwd nextjs >/dev/null; then
    # nextjs 用户不存在：目标 UID 空闲则新建；占用则复用现有用户
    if getent passwd "${PUID}" >/dev/null 2>&1; then
      run_user="$(getent passwd "${PUID}" | cut -d: -f1)"
    else
      adduser -u "${PUID}" -D -S -H -G "${group_name}" nextjs
      run_user="nextjs"
    fi
  else
    # nextjs 用户已存在（镜像构建时创建于 1001）：直接改到目标 UID
    deluser nextjs 2>/dev/null || true
    if getent passwd "${PUID}" >/dev/null 2>&1; then
      run_user="$(getent passwd "${PUID}" | cut -d: -f1)"
    else
      adduser -u "${PUID}" -D -S -H -G "${group_name}" nextjs
      run_user="nextjs"
    fi
  fi

  # /app 中应用运行时可写的子目录需要确保属主正确：
  # public（manifest）、.data（SQLite）、.next（缓存）。
  # 不依赖镜像构建时的 1001（实际运行时可能因挂载/重打包而不同），
  # 统一交给 fix_owner 做 stat 比对，仅在属主不匹配时才递归修正。
  for d in /app/.data /app/.next /app/public; do
    fix_owner "$d"
  done

  # 数据目录（可能是宿主机挂载卷）：仅在属主不匹配时修正。
  # /data 为默认离线下载目录，OFFLINE_DOWNLOAD_DIR 可另行指定。
  for dir in /data "${OFFLINE_DOWNLOAD_DIR:-/data}"; do
    fix_owner "$dir"
  done

  # 降权执行实际命令
  exec su-exec "${run_user}:${group_name}" "$@"
fi

# 非 root 直接执行
exec "$@"
