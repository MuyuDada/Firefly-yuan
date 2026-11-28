// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/utils/lyrics/noLyricLines.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see NOTICE.md in this directory.

import type { Line } from "./lyricData";

// The one "no lyrics" value to hand a visualizer. A fresh `[]` per render reads as new lyric data
// every time the host re-renders, so memoized renderers recompute. Frozen so an accidental push
// throws instead of leaking lines into every lyric-less song.

export const NO_LYRIC_LINES: Line[] = Object.freeze([]) as unknown as Line[];
