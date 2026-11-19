#!/usr/bin/env bash
set -euo pipefail

tag='<script src="https://beetlebox-studios.github.io/js/header.js" data-standalone></script>'
status=0
for page in */index.html; do
  if ! grep -qF '<header id="navbar"></header>' "$page" || ! grep -qF "$tag" "$page"; then
    echo "$page: missing the shared header"
    status=1
  fi
  if grep -qE 'class="navbar-|#navbar\s*\{|\.navbar-[a-z-]+\s*\{' "$page"; then
    echo "$page: restyles or rebuilds the header"
    status=1
  fi
done
exit $status
