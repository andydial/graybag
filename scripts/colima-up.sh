#!/usr/bin/env bash
# Start Colima with its VM on the EXTERNAL volume and /Volumes/Data mounted writable.
#
# =============================================================================
# WHY THIS SCRIPT EXISTS RATHER THAN A README LINE
# =============================================================================
#
# Two failures, both of which have already cost this project a day between them:
#
# 1. **The VM image filled the boot disk.** Colima keeps its disk under `$COLIMA_HOME`, which
#    defaults to `~/.colima` — 11 GB of it, on a 204 GB system volume. `COLIMA_HOME` moves it.
#
#    Note that `colima delete` does NOT remove the disk: Lima tracks named disks separately from
#    instances, so deleting the VM left an orphaned 11 GB `_disks/colima` behind. If you are
#    reclaiming space, `limactl disk list` is the thing to check.
#
# 2. **`COLIMA_HOME` cannot simply be moved to the external volume**, which was the first thing
#    tried. It relocates the docker SOCKET as well as the disk, and a unix socket on virtiofs
#    cannot be bind-mounted into a container — `supabase start` fails on `supabase_vector` with
#    "error while creating mount source path ... operation not supported", then everything
#    downstream fails to connect to Postgres.
#
#    So the split is: **sockets stay on APFS, the disk moves.** `~/.colima/_lima` — 9.9 GB of the
#    10 GB total — is a symlink to the external volume; `~/.colima/default/` (12 KB of sockets)
#    is a real directory on the boot disk.
#
# 3. **The external volume was not mounted when Colima started.** Colima fixes its mounts at
#    start time; there is no settings pane and no reconciliation later. Start it without
#    `/Volumes/Data` present and the VM comes up healthy with an EMPTY directory where the
#    project should be — which is the worst shape of failure, because every tool then reports
#    something else: `supabase test db` finds zero test files and exits 0, `functions deploy`
#    says "entrypoint path does not exist" about a file you can see on disk.
#
#    Both were diagnosed the long way. This script refuses to start instead.
# =============================================================================
set -euo pipefail

VOLUME=/Volumes/Data
DISK_STORE=/Volumes/Data/AD/Projects/Claude/Installs/colima/_lima
LIMA_LINK="$HOME/.colima/_lima"

if [ ! -d "$VOLUME" ] || ! mount | grep -q " $VOLUME "; then
  cat >&2 <<EOF

  ✗ $VOLUME is not mounted.

  Colima cannot start, and this script is refusing rather than letting it: Colima fixes its
  mounts at start time, so a VM started now would come up HEALTHY with an empty directory where
  the project should be. You would then see, in this order:

      supabase test db          → "Files=0, Tests=0, Result: NOTESTS", exit code 0
      supabase functions deploy → "entrypoint path does not exist" about a file that exists

  Neither names the real cause. Plug the volume in, confirm it with:

      mount | grep $VOLUME

  and run this again.

EOF
  exit 1
fi

# The disk store, and the symlink that points Lima at it. Both are re-established here rather
# than assumed, so a fresh machine or a deleted ~/.colima recovers by running this script.
mkdir -p "$DISK_STORE"
if [ ! -L "$LIMA_LINK" ]; then
  if [ -d "$LIMA_LINK" ]; then
    echo "✗ $LIMA_LINK is a real directory, not a symlink." >&2
    echo "  That means the VM disk is back on the boot disk. Move it aside and re-run:" >&2
    echo "      mv $LIMA_LINK $LIMA_LINK.boot-disk-backup" >&2
    exit 1
  fi
  mkdir -p "$HOME/.colima"
  ln -s "$DISK_STORE" "$LIMA_LINK"
  echo "linked $LIMA_LINK -> $DISK_STORE"
fi

echo "VM disk:  $DISK_STORE  (sockets stay on APFS under ~/.colima)"
echo "mounting $VOLUME writable"

# `vz` + `virtiofs` is what this machine was already using and is the fast path on Apple silicon.
# 4 CPU / 8 GB is sized for the Supabase stack (Postgres, Auth, PostgREST, Storage, Studio,
# Realtime, Mailpit) with room for a build; the host has 8 CPU / 32 GB.
exec colima start \
  --vm-type vz \
  --mount-type virtiofs \
  --mount "$VOLUME:w" \
  --cpu 4 \
  --memory 8 \
  --disk 60 \
  "$@"
